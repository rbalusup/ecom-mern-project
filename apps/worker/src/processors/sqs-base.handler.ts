import type { SQSEvent, SQSRecord, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { Redis } from 'ioredis';

import { createLogger } from '@ecom/observability';
import { extractSQSTraceContext } from '@ecom/observability';
import { connectDB } from '@ecom/db';

import { acquireIdempotencyLock } from './idempotency.js';

export interface SQSHandlerContext {
  redis: Redis;
  logger: ReturnType<typeof createLogger>;
  traceId: string | undefined;
}

export type SQSMessageProcessor<T = unknown> = (
  payload: T,
  record: SQSRecord,
  ctx: SQSHandlerContext,
) => Promise<void>;

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return _redis;
}

/**
 * Factory that wraps a typed message processor with:
 * - OTel trace context extraction from SQS message attributes
 * - Idempotency guard (Redis SETNX on messageId)
 * - Per-item failure reporting (SQS partial batch response)
 * - MongoDB lazy connection (warm Lambda containers skip reconnect)
 */
export function createSQSHandler<T>(
  processorName: string,
  processor: SQSMessageProcessor<T>,
) {
  const logger = createLogger({
    service: processorName,
    env: process.env['NODE_ENV'] ?? 'production',
    level: process.env['LOG_LEVEL'] ?? 'info',
  });

  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const mongoUri = process.env['MONGODB_URI'];
    if (!mongoUri) throw new Error('MONGODB_URI not set');
    await connectDB({ uri: mongoUri });

    const redis = getRedis();
    const itemFailures: SQSBatchItemFailure[] = [];

    await Promise.all(
      event.Records.map(async (record) => {
        // Transform SQS Lambda attribute format → observability format
        const rawAttrs = record.messageAttributes ?? {};
        const normalizedAttrs = Object.fromEntries(
          Object.entries(rawAttrs)
            .filter(([, v]) => v.stringValue !== undefined)
            .map(([k, v]) => [k, { DataType: v.dataType, StringValue: v.stringValue! }]),
        );
        const { traceId, spanId } = extractSQSTraceContext(normalizedAttrs);
        const childLogger = logger.child({
          messageId: record.messageId,
          traceId,
          spanId,
          queue: record.eventSourceARN?.split(':').pop(),
        });

        // Idempotency guard — skip if already processed
        const locked = await acquireIdempotencyLock(redis, record.messageId);
        if (!locked) {
          childLogger.info('Skipping duplicate message (idempotency lock held)');
          return;
        }

        let payload: T;
        try {
          payload = JSON.parse(record.body) as T;
        } catch (err) {
          childLogger.error({ err }, 'Failed to parse SQS message body');
          itemFailures.push({ itemIdentifier: record.messageId });
          return;
        }

        try {
          await processor(payload, record, { redis, logger: childLogger, traceId });
          childLogger.info({ processorName }, 'Message processed successfully');
        } catch (err) {
          childLogger.error({ err, processorName }, 'Message processing failed');
          itemFailures.push({ itemIdentifier: record.messageId });
        }
      }),
    );

    return { batchItemFailures: itemFailures };
  };
}
