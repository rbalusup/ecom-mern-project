import type { OrderStatus } from './order.types.js';

// EventBridge event source prefix
export const EVENT_SOURCE = 'com.ecom.genai' as const;

// ─── Event Type Catalog ──────────────────────────────────────────────────────

export type EventType =
  | 'order.created'
  | 'order.status.changed'
  | 'order.payment.succeeded'
  | 'order.payment.failed'
  | 'product.created'
  | 'product.updated'
  | 'product.inventory.low'
  | 'inventory.updated'
  | 'review.created'
  | 'user.registered'
  | 'embedding.generated'
  | 'ai.query.completed';

// ─── Event Detail Schemas ────────────────────────────────────────────────────

export interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
  orderNumber: string;
  total: number;
  currency: string;
  itemCount: number;
  items: Array<{ productId: string; sku: string; quantity: number }>;
}

export interface OrderStatusChangedEvent {
  orderId: string;
  orderNumber: string;
  customerId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorId: string;
  idempotencyKey: string;
}

export interface OrderPaymentEvent {
  orderId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  reason?: string; // only on failure
}

export interface ProductCreatedEvent {
  productId: string;
  name: string;
  description: string;
  aiDescription?: string;
  categoryId: string;
  tags: string[];
}

export interface ProductUpdatedEvent {
  productId: string;
  changedFields: string[];
  requiresEmbeddingUpdate: boolean;
}

export interface ProductInventoryLowEvent {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  threshold: number;
}

export interface InventoryUpdatedEvent {
  productId: string;
  sku: string;
  delta: number; // positive = restock, negative = sale
  newQuantity: number;
  warehouseId: string;
}

export interface ReviewCreatedEvent {
  reviewId: string;
  productId: string;
  customerId: string;
  rating: number;
  verifiedPurchase: boolean;
}

export interface UserRegisteredEvent {
  userId: string;
  email: string;
  cognitoId: string;
  role: string;
}

export interface EmbeddingGeneratedEvent {
  entityId: string;
  entityType: 'product' | 'user';
  model: string;
  dims: number;
  latencyMs: number;
}

export interface AIQueryCompletedEvent {
  queryId: string;
  userId?: string;
  queryType: string;
  llmModel: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cacheHit: boolean;
}

// ─── Generic Domain Event Wrapper ────────────────────────────────────────────

export interface DomainEvent<T = unknown> {
  id: string; // uuid v4
  type: EventType;
  source: typeof EVENT_SOURCE;
  time: string; // ISO-8601
  correlationId: string;
  traceId?: string;
  detail: T;
}
