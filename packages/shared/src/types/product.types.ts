export type ProductStatus = 'draft' | 'active' | 'archived';

export interface IPrice {
  base: number; // stored as Decimal128 in DB, serialized as number in API
  currency: string; // ISO 4217, e.g. 'USD'
  discountedPrice?: number;
}

export interface IInventory {
  quantity: number;
  reservedQuantity: number;
  warehouseId: string;
  lowStockThreshold: number;
}

export interface IProductImage {
  url: string;
  alt: string;
  isPrimary: boolean;
}

export interface IRating {
  average: number;
  count: number;
}

export interface IProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  description: string;
  aiDescription?: string; // LLM-generated enriched description
  categoryId: string;
  vendorId: string;
  price: IPrice;
  inventory: IInventory;
  images: IProductImage[];
  tags: string[];
  attributes: Record<string, string>;
  rating: IRating;
  embedding?: number[]; // 1536-dim vector (omitted from API responses by default)
  embeddingModel?: string;
  embeddingUpdatedAt?: Date;
  reviewSummary?: string;
  status: ProductStatus;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductSortField = 'price' | 'rating' | 'createdAt' | 'name';
export type SortOrder = 'asc' | 'desc';

export interface IProductFilter {
  categoryId?: string;
  status?: ProductStatus;
  minPrice?: number;
  maxPrice?: number;
  tags?: string[];
  vendorId?: string;
  inStock?: boolean;
  search?: string;
}
