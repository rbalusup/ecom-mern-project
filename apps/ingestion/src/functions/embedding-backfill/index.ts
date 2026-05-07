/**
 * Scheduled Lambda: cursor-based embedding backfill for products missing or
 * stale embeddings. Resumable via Redis checkpoint — safe to re-run.
 *
 * Schedule: EventBridge cron, nightly at 02:00 UTC.
 *
 * Flow:
 *  1. Read last processed _id from Redis checkpoint
 *  2. Fetch BATCH_SIZE products without embeddings (or stale > 7d)
 *  3. Generate embeddings (EmbedderFactory, respects AI_PROVIDER env var)
 *  4. Save embeddings + update checkpoint
 *  5. Repeat until no more products or Lambda timeout approaches
 */

import type { ScheduledHandler } from 'aws-lambda';
import { Redis } from 'ioredis';

import { connectDB, ProductModel } from '@ecom/db';
import { EmbedderFactory } from '@ecom/ai';
import { createLogger, emitEMFMetric, initTracer } from '@ecom/observability';

initTracer({ serviceName: 'ecom-embedding-backfill' });

const BATCH_SIZE = 50;
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const CHECKPOINT_KEY = 'backfill:embedding:checkpoint';
// Leave ~30 seconds buffer before Lambda timeout
const TIMEOUT_BUFFER_MS = 30_000;

const logger = createLogger({
  service: 'ecom-embedding-backfill',
  env: process.env['NODE_ENV'] ?? 'production',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

export const handler: ScheduledHandler = async (_event, lambdaContext) => {
  const mongoUri = process.env['MONGODB_URI'];
  if (!mongoUri) throw new Error('MONGODB_URI not set');
  await connectDB({ uri: mongoUri });

  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
  const embedder = EmbedderFactory.create();
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  let checkpoint = await redis.get(CHECKPOINT_KEY);
  let totalProcessed = 0;
  let totalSkipped = 0;

  logger.info({ checkpoint }, 'Starting embedding backfill');

  while (true) {
    // Stop if approaching Lambda timeout
    const remaining = lambdaContext.getRemainingTimeInMillis();
    if (remaining < TIMEOUT_BUFFER_MS) {
      logger.info({ remaining, totalProcessed }, 'Approaching Lambda timeout — pausing backfill');
      break;
    }

    const filter: Record<string, unknown> = {
      $or: [
        { embeddingUpdatedAt: { $exists: false } },
        { embeddingUpdatedAt: { $lt: staleThreshold } },
      ],
    };
    if (checkpoint) {
      filter['_id'] = { $gt: checkpoint };
    }

    const products = await ProductModel.find(filter)
      .select('_id name description tags')
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean()
      .exec();

    if (products.length === 0) {
      logger.info({ totalProcessed }, 'Backfill complete — no more products to process');
      await redis.del(CHECKPOINT_KEY); // Reset checkpoint for next run
      break;
    }

    // Build text corpus for each product
    const texts = products.map((p) =>
      [p.name, p.description ?? '', (p.tags ?? []).join(' ')].filter(Boolean).join('\n'),
    );

    const embeddings = await embedder.embed(texts);

    // Bulk update
    const bulkOps = products.map((p, i) => ({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            embedding: embeddings[i],
            embeddingModel: process.env['AI_PROVIDER'] === 'bedrock' ? 'titan-v2' : 'text-embedding-3-large',
            embeddingUpdatedAt: new Date(),
          },
        },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ProductModel.bulkWrite(bulkOps as any);
    totalProcessed += products.length;

    // Update checkpoint to last processed _id
    const lastId = products[products.length - 1]!._id.toString();
    await redis.set(CHECKPOINT_KEY, lastId);
    checkpoint = lastId;

    logger.info({ batch: products.length, totalProcessed, lastId }, 'Batch embedded');
  }

  const metricEnv = { env: process.env['NODE_ENV'] ?? 'production' };
  emitEMFMetric('ecom/ingestion', metricEnv, { name: 'EmbeddingBackfillProcessed', value: totalProcessed, unit: 'Count' });
  emitEMFMetric('ecom/ingestion', metricEnv, { name: 'EmbeddingBackfillSkipped', value: totalSkipped, unit: 'Count' });

  await redis.quit();
  logger.info({ totalProcessed, totalSkipped }, 'Embedding backfill Lambda finished');
};
