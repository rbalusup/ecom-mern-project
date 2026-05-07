import type { EventType } from '../types/events.types.js';

export const EVENTS: Record<string, EventType> = {
  ORDER_CREATED: 'order.created',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  ORDER_PAYMENT_SUCCEEDED: 'order.payment.succeeded',
  ORDER_PAYMENT_FAILED: 'order.payment.failed',
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_INVENTORY_LOW: 'product.inventory.low',
  INVENTORY_UPDATED: 'inventory.updated',
  REVIEW_CREATED: 'review.created',
  USER_REGISTERED: 'user.registered',
  EMBEDDING_GENERATED: 'embedding.generated',
  AI_QUERY_COMPLETED: 'ai.query.completed',
} as const;

export const KAFKA_TOPICS = {
  INVENTORY_UPDATES: 'ecom.inventory.updates',
  ORDER_EVENTS: 'ecom.order.events',
  PRODUCT_EVENTS: 'ecom.product.events',
  USER_EVENTS: 'ecom.user.events',
  AI_TELEMETRY: 'ecom.ai.telemetry',
  SEARCH_ANALYTICS: 'ecom.search.analytics',
} as const;

export const SQS_QUEUE_NAMES = {
  ORDER_PROCESSOR: 'ecom-order-processor',
  EMBEDDING_GENERATOR: 'ecom-embedding-generator',
  NOTIFICATION: 'ecom-notification',
  REVIEW_SUMMARIZER: 'ecom-review-summarizer',
  SEARCH_INDEX_SYNC: 'ecom-search-index-sync',
  DLQ_PROCESSOR: 'ecom-dlq-processor',
} as const;
