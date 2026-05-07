/**
 * Processes product.created and product.updated events.
 *
 * Responsibilities:
 *  - Trigger embedding generation for new/updated products
 *  - Forward product events to Kafka ecom.product.events
 *  - Invalidate Redis product cache on update
 */

import type { SQSRecord } from 'aws-lambda';

import { createSQSHandler, type SQSHandlerContext } from '../processors/sqs-base.handler.js';
import { KafkaProducer } from '../kafka/producer.js';

interface ProductEvent {
  'detail-type': 'product.created' | 'product.updated';
  detail: {
    productId: string;
    sku: string;
    name: string;
    vendorId: string;
    categoryId: string;
    fieldsChanged?: string[];
  };
}

async function processProductEvent(
  event: ProductEvent,
  _record: SQSRecord,
  ctx: SQSHandlerContext,
): Promise<void> {
  const { productId, sku } = event.detail;
  const eventType = event['detail-type'];
  ctx.logger.info({ productId, sku, eventType }, 'Processing product event');

  // Invalidate Redis cache so next read gets fresh data
  await ctx.redis.del(`product:${productId}`);

  // Publish to Kafka for downstream consumers
  await KafkaProducer.publish('ecom.product.events', {
    key: productId,
    value: JSON.stringify({
      type: eventType === 'product.created' ? 'PRODUCT_CREATED' : 'PRODUCT_UPDATED',
      ...event.detail,
    }),
    headers: { traceId: ctx.traceId ?? '' },
  });

  // Queue embedding generation — the embedding-generator SQS queue
  // is decoupled so this is fire-and-forget via EventBridge
  const needsEmbedding =
    eventType === 'product.created' ||
    (event.detail.fieldsChanged ?? []).some((f) =>
      ['name', 'description', 'tags', 'attributes'].includes(f),
    );

  if (needsEmbedding) {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eb = new EventBridgeClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: `ecom-genai-${process.env['NODE_ENV'] ?? 'dev'}`,
        Source: 'ecom.product',
        DetailType: 'product.embedding.requested',
        Detail: JSON.stringify({ productId, sku }),
      }],
    }));
    ctx.logger.info({ productId }, 'Queued embedding generation');
  }
}

export const handler = createSQSHandler<ProductEvent>('ecom-product-processor', processProductEvent);
