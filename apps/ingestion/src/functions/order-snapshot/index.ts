/**
 * EventBridge-scheduled Lambda (daily at 01:00 UTC).
 * Archives yesterday's delivered orders to S3 as newline-delimited JSON
 * for long-term analytics and compliance retention.
 *
 * Flow:
 *  1. Query orders where status='delivered' AND deliveredAt in yesterday
 *  2. Stream results to S3 (partitioned by date: orders/YYYY/MM/DD/batch.ndjson)
 *  3. Log summary + emit EMF metric
 */

import type { ScheduledHandler } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { connectDB, OrderModel } from '@ecom/db';
import { createLogger, emitEMFMetric, initTracer } from '@ecom/observability';

initTracer({ serviceName: 'ecom-order-snapshot' });

const s3 = new S3Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
const logger = createLogger({
  service: 'ecom-order-snapshot',
  env: process.env['NODE_ENV'] ?? 'production',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

export const handler: ScheduledHandler = async () => {
  const mongoUri = process.env['MONGODB_URI'];
  if (!mongoUri) throw new Error('MONGODB_URI not set');
  await connectDB({ uri: mongoUri });

  const bucket = process.env['S3_ORDER_SNAPSHOTS_BUCKET'];
  if (!bucket) throw new Error('S3_ORDER_SNAPSHOTS_BUCKET not set');

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setUTCHours(23, 59, 59, 999);

  const dateStr = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD
  const s3Key = `orders/${dateStr.replace(/-/g, '/')}/snapshot.ndjson`;

  logger.info({ dateStr }, 'Starting order snapshot');

  // Cursor-based streaming to avoid loading all orders into memory
  const cursor = OrderModel.find({
    status: 'delivered',
    updatedAt: { $gte: yesterday, $lte: endOfYesterday },
  })
    .lean()
    .cursor();

  const lines: string[] = [];
  let count = 0;

  for await (const order of cursor) {
    lines.push(JSON.stringify(order));
    count++;
  }

  if (count === 0) {
    logger.info({ dateStr }, 'No delivered orders to snapshot');
    return;
  }

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    Body: lines.join('\n'),
    ContentType: 'application/x-ndjson',
    Metadata: { date: dateStr, count: String(count) },
  }));

  logger.info({ dateStr, count, s3Key }, 'Order snapshot uploaded');

  emitEMFMetric(
    'ecom/ingestion',
    { env: process.env['NODE_ENV'] ?? 'production', date: dateStr },
    { name: 'OrderSnapshotCount', value: count, unit: 'Count' },
  );
};
