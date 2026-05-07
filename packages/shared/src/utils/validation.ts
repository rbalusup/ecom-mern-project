import { z } from 'zod';

import type { ValidationError } from '../errors/index.js';

export function safeParseOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  ErrorClass: new (msg: string, details?: unknown) => ValidationError,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ErrorClass('Validation failed', result.error.flatten());
  }
  return result.data;
}

// ─── Common Zod Schemas ───────────────────────────────────────────────────────

export const ObjectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId');

export const CursorSchema = z.string().base64url().optional();

export const PaginationSchema = z.object({
  first: z.number().int().min(1).max(100).default(20).optional(),
  after: CursorSchema,
});

export const AddressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2).toUpperCase(),
  isDefault: z.boolean().optional(),
});

export const CreateOrderItemSchema = z.object({
  productId: ObjectIdSchema,
  quantity: z.number().int().min(1).max(999),
});

export const CreateOrderSchema = z.object({
  items: z.array(CreateOrderItemSchema).min(1).max(50),
  shippingAddress: AddressSchema,
  couponCode: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

export const CreateProductSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  categoryId: ObjectIdSchema,
  sku: z.string().min(1).max(100),
  price: z.object({
    base: z.number().positive(),
    currency: z.string().length(3).toUpperCase(),
    discountedPrice: z.number().positive().optional(),
  }),
  inventory: z.object({
    quantity: z.number().int().min(0),
    warehouseId: z.string().min(1),
    lowStockThreshold: z.number().int().min(0).default(10),
  }),
  tags: z.array(z.string().max(50)).max(20).default([]),
  attributes: z.record(z.string()).default({}),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type CreateProductInput = z.infer<typeof CreateProductSchema>;
