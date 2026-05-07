import { Schema, model, type Document, type Types } from 'mongoose';

import { ORDER_TRANSITIONS } from '@ecom/shared';

import type { OrderStatus } from '@ecom/shared';

// ─── Order Document ──────────────────────────────────────────────────────────

export interface IOrderDocument extends Document {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  status: OrderStatus;
  items: Array<{
    productId: Types.ObjectId;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: Types.Decimal128;
    totalPrice: Types.Decimal128;
    imageUrl?: string;
  }>;
  pricing: {
    subtotal: Types.Decimal128;
    tax: Types.Decimal128;
    shipping: Types.Decimal128;
    discount: Types.Decimal128;
    total: Types.Decimal128;
    currency: string;
  };
  couponId?: Types.ObjectId;
  shippingAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  paymentMethod: {
    type: string;
    last4?: string;
    provider: string;
  };
  paymentIntentId?: string;
  trackingNumber?: string;
  notes?: string;
  metadata: Map<string, string>;
  createdAt: Date;
  updatedAt: Date;
  // Virtual
  canTransitionTo(status: OrderStatus): boolean;
}

const OrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Schema.Types.Decimal128, required: true },
    totalPrice: { type: Schema.Types.Decimal128, required: true },
    imageUrl: { type: String },
  },
  { _id: false },
);

const OrderSchema = new Schema<IOrderDocument>(
  {
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: Object.keys(ORDER_TRANSITIONS),
      default: 'pending_payment',
      required: true,
    },
    items: { type: [OrderItemSchema], required: true, validate: [(v: unknown[]) => v.length > 0, 'Order must have at least one item'] },
    pricing: {
      subtotal: { type: Schema.Types.Decimal128, required: true },
      tax: { type: Schema.Types.Decimal128, required: true },
      shipping: { type: Schema.Types.Decimal128, required: true },
      discount: { type: Schema.Types.Decimal128, default: 0 },
      total: { type: Schema.Types.Decimal128, required: true },
      currency: { type: String, required: true, default: 'USD' },
    },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    shippingAddress: {
      line1: { type: String, required: true },
      line2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true, default: 'US' },
    },
    paymentMethod: {
      type: { type: String, required: true },
      last4: { type: String },
      provider: { type: String, required: true },
    },
    paymentIntentId: { type: String },
    trackingNumber: { type: String },
    notes: { type: String, maxlength: 1000 },
    metadata: { type: Map, of: String, default: {} },
  },
  {
    timestamps: true,
    collection: 'orders',
  },
);

OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ customerId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ paymentIntentId: 1 }, { sparse: true });
OrderSchema.index({ 'items.productId': 1 }); // for "frequently bought together"

OrderSchema.methods['canTransitionTo'] = function (this: IOrderDocument, status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[this.status]?.includes(status) ?? false;
};

export const OrderModel = model<IOrderDocument>('Order', OrderSchema);

// ─── OrderEvent Document (event sourcing log) ────────────────────────────────

export interface IOrderEventDocument extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  eventType: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorId: Types.ObjectId;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  timestamp: Date;
}

const OrderEventSchema = new Schema<IOrderEventDocument>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    eventType: { type: String, required: true },
    fromStatus: { type: String, required: true },
    toStatus: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    idempotencyKey: { type: String, required: true, unique: true },
    timestamp: { type: Date, default: Date.now },
  },
  {
    collection: 'order_events',
    timestamps: false,
  },
);

OrderEventSchema.index({ orderId: 1, timestamp: -1 });
OrderEventSchema.index({ idempotencyKey: 1 }, { unique: true });

export const OrderEventModel = model<IOrderEventDocument>('OrderEvent', OrderEventSchema);
