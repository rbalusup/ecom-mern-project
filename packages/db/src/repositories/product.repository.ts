import type { FilterQuery } from 'mongoose';

import type { IConnection, IPaginationArgs, IProductFilter } from '@ecom/shared';

import { ProductModel, type IProductDocument } from '../models/Product.model.js';
import { BaseRepository } from './base.repository.js';

export class ProductRepository extends BaseRepository<IProductDocument> {
  constructor() {
    super(ProductModel);
  }

  async findBySku(sku: string): Promise<IProductDocument | null> {
    return this.model.findOne({ sku: sku.toUpperCase(), isDeleted: false }).lean<IProductDocument>().exec();
  }

  async findBySlug(slug: string): Promise<IProductDocument | null> {
    return this.model.findOne({ slug, isDeleted: false }).lean<IProductDocument>().exec();
  }

  async findWithFilters(
    filter: IProductFilter,
    args: IPaginationArgs,
  ): Promise<IConnection<IProductDocument>> {
    const query: FilterQuery<IProductDocument> = { isDeleted: false };

    if (filter.categoryId) query['categoryId'] = filter.categoryId;
    if (filter.status) query['status'] = filter.status;
    if (filter.vendorId) query['vendorId'] = filter.vendorId;
    if (filter.tags?.length) query['tags'] = { $in: filter.tags };
    if (filter.inStock) query['inventory.quantity'] = { $gt: 0 };

    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      query['price.base'] = {
        ...(filter.minPrice !== undefined && { $gte: filter.minPrice }),
        ...(filter.maxPrice !== undefined && { $lte: filter.maxPrice }),
      };
    }

    return this.findWithCursorPagination(query, args, { field: 'createdAt', order: 'desc' });
  }

  async decrementInventory(productId: string, quantity: number): Promise<IProductDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: productId,
          'inventory.quantity': { $gte: quantity },
        },
        {
          $inc: { 'inventory.quantity': -quantity, 'inventory.reservedQuantity': quantity },
        },
        { new: true },
      )
      .lean<IProductDocument>()
      .exec();
  }

  async updateRating(
    productId: string,
    newAverage: number,
    newCount: number,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: productId },
      { $set: { 'rating.average': newAverage, 'rating.count': newCount } },
    );
  }

  async findNeedingEmbeddingUpdate(limit: number): Promise<IProductDocument[]> {
    return this.model
      .find({
        status: 'active',
        isDeleted: false,
        $or: [{ embeddingUpdatedAt: null }, { embeddingUpdatedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }],
      })
      .select('+embedding')
      .limit(limit)
      .lean<IProductDocument[]>()
      .exec();
  }

  async updateEmbedding(
    productId: string,
    embedding: number[],
    model: string,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: productId },
      {
        $set: {
          embedding,
          embeddingModel: model,
          embeddingUpdatedAt: new Date(),
        },
      },
    );
  }
}
