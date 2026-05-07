import { Schema, model, type Document, type Types } from 'mongoose';

export interface IProductDocument extends Document {
  _id: Types.ObjectId;
  sku: string;
  slug: string;
  name: string;
  description: string;
  aiDescription?: string;
  categoryId: Types.ObjectId;
  vendorId: Types.ObjectId;
  price: {
    base: Types.Decimal128;
    currency: string;
    discountedPrice?: Types.Decimal128;
  };
  inventory: {
    quantity: number;
    reservedQuantity: number;
    warehouseId: string;
    lowStockThreshold: number;
  };
  images: Array<{ url: string; alt: string; isPrimary: boolean }>;
  tags: string[];
  attributes: Map<string, string>;
  rating: { average: number; count: number };
  embedding: number[];
  embeddingModel: string;
  embeddingUpdatedAt?: Date;
  reviewSummary?: string;
  status: 'draft' | 'active' | 'archived';
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProductDocument>(
  {
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 300 },
    name: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, required: true, maxlength: 10000 },
    aiDescription: { type: String, maxlength: 5000 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    price: {
      base: { type: Schema.Types.Decimal128, required: true },
      currency: { type: String, required: true, length: 3, uppercase: true, default: 'USD' },
      discountedPrice: { type: Schema.Types.Decimal128 },
    },
    inventory: {
      quantity: { type: Number, required: true, min: 0, default: 0 },
      reservedQuantity: { type: Number, default: 0, min: 0 },
      warehouseId: { type: String, required: true },
      lowStockThreshold: { type: Number, default: 10, min: 0 },
    },
    images: {
      type: [
        {
          url: { type: String, required: true, maxlength: 500 },
          alt: { type: String, maxlength: 200 },
          isPrimary: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    tags: { type: [String], default: [], validate: [(v: string[]) => v.length <= 20, 'Max 20 tags'] },
    attributes: { type: Map, of: String, default: {} },
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },
    // 1536-dim vector for Atlas Vector Search (text-embedding-3-large / Titan V2)
    embedding: { type: [Number], default: [], select: false },
    embeddingModel: { type: String, default: '' },
    embeddingUpdatedAt: { type: Date },
    reviewSummary: { type: String, maxlength: 2000 },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'products',
  },
);

// Compound indexes for query patterns
ProductSchema.index({ categoryId: 1, status: 1, isDeleted: 1 });
ProductSchema.index({ vendorId: 1, status: 1 });
ProductSchema.index({ 'price.base': 1 });
ProductSchema.index({ tags: 1 }); // multikey
ProductSchema.index({ status: 1, isDeleted: 1, createdAt: -1 });
ProductSchema.index({ 'rating.average': -1, 'rating.count': -1 });
ProductSchema.index({ embeddingUpdatedAt: 1 }); // for backfill queries
ProductSchema.index({ sku: 1 }, { unique: true });
ProductSchema.index({ slug: 1 }, { unique: true });

// Note: Atlas Search and Vector Search indexes are created separately via scripts/atlas/

export const ProductModel = model<IProductDocument>('Product', ProductSchema);
