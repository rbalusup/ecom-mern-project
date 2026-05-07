export type OrderStatus =
  | 'pending_payment'
  | 'payment_processing'
  | 'payment_failed'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'return_requested'
  | 'returned'
  | 'cancelled';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['payment_processing', 'cancelled'],
  payment_processing: ['confirmed', 'payment_failed'],
  payment_failed: ['pending_payment', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped'],
  shipped: ['delivered'],
  delivered: ['return_requested'],
  return_requested: ['returned'],
  returned: [],
  cancelled: [],
};

export const TERMINAL_ORDER_STATES: OrderStatus[] = ['delivered', 'returned', 'cancelled'];

export interface IOrderItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl?: string;
}

export interface IOrderPricing {
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  total: number;
  currency: string;
}

export interface IPaymentMethod {
  type: 'card' | 'paypal' | 'bank_transfer';
  last4?: string;
  provider: string; // 'stripe' | 'paypal' | etc.
}

export interface IOrder {
  id: string;
  orderNumber: string; // e.g. ORD-2026-00001
  customerId: string;
  status: OrderStatus;
  items: IOrderItem[];
  pricing: IOrderPricing;
  couponId?: string;
  shippingAddress: import('./user.types.js').IAddress;
  paymentMethod: IPaymentMethod;
  paymentIntentId?: string;
  trackingNumber?: string;
  notes?: string;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrderEvent {
  id: string;
  orderId: string;
  eventType: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  timestamp: Date;
}

export interface IOrderFilter {
  customerId?: string;
  status?: OrderStatus;
  fromDate?: Date;
  toDate?: Date;
  minTotal?: number;
}
