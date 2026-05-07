/**
 * Processes inventory.updated events from EventBridge → SQS.
 *
 * Responsibilities:
 *  - Update product inventory in MongoDB (atomic $inc)
 *  - Publish to Kafka ecom.inventory.updates topic
 *  - Push WebSocket notification if stock is now low or out-of-stock
 *  - Trigger SNS ops-alert if inventory falls below threshold
 */

import type { SQSRecord } from 'aws-lambda';

import { ProductModel } from '@ecom/db';

import { createSQSHandler, type SQSHandlerContext } from '../processors/sqs-base.handler.js';
import { KafkaProducer } from '../kafka/producer.js';

interface InventoryUpdatedEvent {
  'detail-type': 'inventory.updated';
  detail: {
    productId: string;
    delta: number; // positive = restock, negative = sale/reservation
    reason: 'sale' | 'return' | 'restock' | 'adjustment' | 'reservation' | 'release';
    warehouseId?: string;
  };
}

async function processInventoryEvent(
  event: InventoryUpdatedEvent,
  _record: SQSRecord,
  ctx: SQSHandlerContext,
): Promise<void> {
  const { productId, delta, reason } = event.detail;
  ctx.logger.info({ productId, delta, reason }, 'Processing inventory.updated event');

  const field = reason === 'reservation' ? 'inventory.reservedQuantity' : 'inventory.quantity';
  const updated = await ProductModel.findByIdAndUpdate(
    productId,
    { $inc: { [field]: delta } },
    { new: true },
  )
    .select('inventory name sku')
    .lean()
    .exec();

  if (!updated) {
    ctx.logger.warn({ productId }, 'Product not found for inventory update');
    return;
  }

  const available = updated.inventory.quantity - updated.inventory.reservedQuantity;
  const isLow = available <= updated.inventory.lowStockThreshold && available > 0;
  const isOos = available <= 0;

  ctx.logger.info({ productId, available, isLow, isOos }, 'Inventory updated');

  // Push real-time update to Redis pub/sub for GraphQL subscriptions
  await ctx.redis.publish(
    `inventory:${productId}`,
    JSON.stringify({ productId, available, isLow, isOos, reason }),
  );

  // Publish to Kafka for analytics/reporting downstream
  await KafkaProducer.publish('ecom.inventory.updates', {
    key: productId,
    value: JSON.stringify({
      productId,
      sku: updated.sku,
      quantity: updated.inventory.quantity,
      reservedQuantity: updated.inventory.reservedQuantity,
      available,
      reason,
    }),
    headers: { traceId: ctx.traceId ?? '' },
  });

  // Publish low-stock alert to EventBridge if threshold crossed
  if (isLow || isOos) {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eb = new EventBridgeClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: `ecom-genai-${process.env['NODE_ENV'] ?? 'dev'}`,
        Source: 'ecom.inventory',
        DetailType: 'product.inventory.low',
        Detail: JSON.stringify({ productId, sku: updated.sku, available, isOos }),
      }],
    }));
  }
}

export const handler = createSQSHandler<InventoryUpdatedEvent>('ecom-inventory-processor', processInventoryEvent);
