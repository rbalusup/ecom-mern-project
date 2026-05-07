import { Schema, model, type Document, type Types } from 'mongoose';

export interface IReviewDocument extends Document {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  customerId: Types.ObjectId;
  orderId?: Types.ObjectId;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  helpful: number; // upvote count
  aiSummaryContribution: boolean; // included in LLM review summary
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReviewDocument>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 5000 },
    verifiedPurchase: { type: Boolean, default: false },
    helpful: { type: Number, default: 0, min: 0 },
    aiSummaryContribution: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'reviews',
  },
);

// One review per customer per product
ReviewSchema.index({ productId: 1, customerId: 1 }, { unique: true });
ReviewSchema.index({ productId: 1, rating: -1, createdAt: -1 });
ReviewSchema.index({ customerId: 1, createdAt: -1 });
ReviewSchema.index({ verifiedPurchase: 1, productId: 1 });

export const ReviewModel = model<IReviewDocument>('Review', ReviewSchema);
