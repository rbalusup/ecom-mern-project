import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICartDocument extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  items: Array<{
    productId: Types.ObjectId;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: Types.Decimal128; // price snapshot at add-to-cart time
    imageUrl?: string;
  }>;
  couponId?: Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CartItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, max: 999 },
    unitPrice: { type: Schema.Types.Decimal128, required: true },
    imageUrl: { type: String },
  },
  { _id: false },
);

const CartSchema = new Schema<ICartDocument>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [CartItemSchema], default: [] },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  },
  {
    timestamps: true,
    collection: 'carts',
  },
);

CartSchema.index({ customerId: 1 }, { unique: true });
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

export const CartModel = model<ICartDocument>('Cart', CartSchema);
