import { Schema, model, type Document, type Types } from 'mongoose';

export interface IUserDocument extends Document {
  _id: Types.ObjectId;
  email: string;
  cognitoId: string;
  role: 'customer' | 'admin' | 'vendor';
  profile: {
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    phone?: string;
    addresses: Array<{
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
      isDefault?: boolean;
    }>;
    preferences: string[];
  };
  profileEmbedding?: number[];
  embeddingUpdatedAt?: Date;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema(
  {
    line1: { type: String, required: true, maxlength: 200 },
    line2: { type: String, maxlength: 200 },
    city: { type: String, required: true, maxlength: 100 },
    state: { type: String, required: true, maxlength: 100 },
    postalCode: { type: String, required: true, maxlength: 20 },
    country: { type: String, required: true, length: 2 },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false },
);

const UserSchema = new Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    cognitoId: { type: String, required: true, unique: true },
    role: { type: String, enum: ['customer', 'admin', 'vendor'], default: 'customer' },
    profile: {
      firstName: { type: String, required: true, maxlength: 100 },
      lastName: { type: String, required: true, maxlength: 100 },
      avatarUrl: { type: String, maxlength: 500 },
      phone: { type: String, maxlength: 20 },
      addresses: { type: [AddressSchema], default: [] },
      preferences: { type: [String], default: [] },
    },
    profileEmbedding: { type: [Number], select: false }, // excluded by default
    embeddingUpdatedAt: { type: Date },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

// Indexes
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ cognitoId: 1 }, { unique: true });
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ createdAt: -1 });

export const UserModel = model<IUserDocument>('User', UserSchema);
