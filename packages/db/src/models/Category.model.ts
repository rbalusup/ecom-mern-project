import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICategoryDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  parentId?: Types.ObjectId;
  level: number; // 0 = root, 1 = sub, 2 = leaf
  path: string; // materialized path e.g. "electronics/phones/smartphones"
  embedding?: number[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategoryDocument>(
  {
    name: { type: String, required: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, maxlength: 1000 },
    imageUrl: { type: String, maxlength: 500 },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    level: { type: Number, default: 0, min: 0, max: 3 },
    path: { type: String, required: true }, // e.g. "electronics/phones"
    embedding: { type: [Number], select: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'categories',
  },
);

CategorySchema.index({ slug: 1 }, { unique: true });
CategorySchema.index({ parentId: 1, isActive: 1 });
CategorySchema.index({ level: 1 });
CategorySchema.index({ path: 1 });

export const CategoryModel = model<ICategoryDocument>('Category', CategorySchema);
