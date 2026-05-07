/**
 * Processes order.created and order.status.changed EventBridge events
 * delivered via the ecom-order-processor SQS queue.
 *
 * Responsibilities:
 *  - Validate and persist the order state transition via OrderRepository
 *  - Publish inventory.updated event to Kafka (ecom.inventory.updates)
 *  - Push real-time status update to Redis pub/sub for WebSocket subscriptions
 */

import type { SQSRecord } from 'aws-lambda';

import { OrderRepository } from '@ecom/db';
import { ORDER_TRANSITIONS } from '@ecom/shared';
import type { OrderStatus } from '@ecom/shared';

import { createSQSHandler, type SQSHandlerContext } from '../processors/sqs-base.handler.js';
import { KafkaProducer } from '../kafka/producer.js';

interface OrderCreatedEvent {
  'detail-type': 'order.created';
  detail: {
    orderId: string;
    customerId: string;
    orderNumber: string;
    totalAmount: number;
    currency: string;
    items: Array<{ productId: string; sku: string; quantity: number }>;
  };
}

interface OrderStatusChangedEvent {
  'detail-type': 'order.status.changed';
  detail: {
    orderId: string;
    fromStatus: OrderStatus;
    toStatus: OrderStatus;
    updatedBy: string;
    notes?: string;
  };
}

type OrderEvent = OrderCreatedEvent | OrderStatusChangedEvent;

const orderRepo = new OrderRepository();

async function processOrderEvent(
  event: OrderEvent,
  _record: SQSRecord,
  ctx: SQSHandlerContext,
): Promise<void> {
  if (event['detail-type'] === 'order.created') {
    const { orderId, customerId } = event.detail;
    ctx.logger.info({ orderId, customerId }, 'Processing order.created event');

    // Publish to Kafka for downstream consumers (analytics, notification service)
    await KafkaProducer.publish('ecom.order.events', {
      key: orderId,
      value: JSON.stringify({ type: 'ORDER_CREATED', ...event.detail }),
      headers: { traceId: ctx.traceId ?? '' },
    });

    // Push real-time update to Redis pub/sub channel for GraphQL subscriptions
    await ctx.redis.publish(
      `order:status:${orderId}`,
      JSON.stringify({ orderId, status: 'pending_payment' }),
    );

    return;
  }

  if (event['detail-type'] === 'order.status.changed') {
    const { orderId, fromStatus, toStatus, updatedBy, notes } = event.detail;

    // Guard: validate the transition is allowed before touching the DB
    if (!ORDER_TRANSITIONS[fromStatus]?.includes(toStatus)) {
      ctx.logger.warn({ orderId, fromStatus, toStatus }, 'Invalid order transition in event — skipping');
      return;
    }

    await orderRepo.transitionStatus(orderId, toStatus, updatedBy, { notes });
    ctx.logger.info({ orderId, fromStatus, toStatus }, 'Order status transitioned');

    // Notify GraphQL subscription subscribers
    const order = await orderRepo.findById(orderId);
    await ctx.redis.publish(
      `order:status:${orderId}`,
      JSON.stringify({ orderId, status: toStatus, order }),
    );

    await KafkaProducer.publish('ecom.order.events', {
      key: orderId,
      value: JSON.stringify({ type: 'ORDER_STATUS_CHANGED', orderId, fromStatus, toStatus }),
      headers: { traceId: ctx.traceId ?? '' },
    });
  }
}

export const handler = createSQSHandler<OrderEvent>('ecom-order-processor', processOrderEvent);
