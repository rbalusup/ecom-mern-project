/**
 * Dead-Letter Queue processor — receives poison messages that exceeded
 * maxReceiveCount on their source queue.
 *
 * Responsibilities:
 *  - Log the full message payload for ops investigation
 *  - Emit a CloudWatch EMF metric so the DLQ-depth alarm fires
 *  - Store the failed message in MongoDB for manual replay (optional)
 */

import type { SQSEvent } from 'aws-lambda';

import { createLogger, emitEMFMetric } from '@ecom/observability';

const logger = createLogger({
  service: 'ecom-dlq-processor',
  env: process.env['NODE_ENV'] ?? 'production',
  level: process.env['LOG_LEVEL'] ?? 'warn',
});

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    const sourceQueue = record.eventSourceARN?.split(':').pop() ?? 'unknown';

    logger.error(
      {
        messageId: record.messageId,
        sourceQueue,
        approximateReceiveCount: record.attributes.ApproximateReceiveCount,
        body: record.body,
        messageAttributes: record.messageAttributes,
      },
      'Poison message landed in DLQ',
    );

    // Emit CloudWatch metric so the DLQ-depth alarm fires
    emitEMFMetric(
      'ecom/worker',
      { sourceQueue, env: process.env['NODE_ENV'] ?? 'production' },
      { name: 'DLQPoisonMessage', value: 1, unit: 'Count' },
    );
  }
}
