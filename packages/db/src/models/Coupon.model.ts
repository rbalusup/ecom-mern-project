import { Schema, model, type Document, type Types } from 'mongoose';

export type CouponType = 'percent' | 'fixed' | 'free_shipping';

export interface ICouponDocument extends Document {
  _id: Types.ObjectId;
  code: string;
  type: CouponType;
  value: number; // percent (0-100) or fixed amount
  minOrderValue?: number;
  maxDiscountAmount?: number; // cap for percent coupons
  usageLimit?: number; // null = unlimited
  usedCount: number;
  perUserLimit: number;
  applicableCategories: Types.ObjectId[];
  applicableProducts: Types.ObjectId[];
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICouponDocument>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 50 },
    type: { type: String, enum: ['percent', 'fixed', 'free_shipping'], required: true },
    value: { type: Number, required: true, min: 0 },
    minOrderValue: { type: Number, min: 0 },
    maxDiscountAmount: { type: Number, min: 0 },
    usageLimit: { type: Number, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 1, min: 1 },
    applicableCategories: { type: [Schema.Types.ObjectId], ref: 'Category', default: [] },
    applicableProducts: { type: [Schema.Types.ObjectId], ref: 'Product', default: [] },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'coupons',
  },
);

CouponSchema.index({ code: 1 }, { unique: true });
CouponSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });

export const CouponModel = model<ICouponDocument>('Coupon', CouponSchema);
