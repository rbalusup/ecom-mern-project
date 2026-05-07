import { OrderModel, ProductModel, buildFrequentlyBoughtTogetherPipeline, buildVectorSearchPipeline } from '@ecom/db';

import { EmbedderFactory } from '../embeddings/factory.js';

interface ProductLike {
  _id?: unknown;
  embedding?: number[] | undefined;
  name?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
}

export class RecommendationChain {
  async similarProducts(product: ProductLike, limit: number): Promise<unknown[]> {
    let embedding = product.embedding;

    if (!embedding?.length) {
      // Derive embedding from product text when not pre-stored
      const text = [product.name, product.description, (product.tags ?? []).join(' ')]
        .filter(Boolean)
        .join('\n');
      const embedder = EmbedderFactory.create();
      const results = await embedder.embed([text]);
      const result = results[0];
      if (!result) return [];
      embedding = result;
    }

    const pipeline = buildVectorSearchPipeline(embedding, limit + 1, limit * 10);
    const results: Array<Record<string, unknown>> = await ProductModel.aggregate(pipeline).exec();

    // Exclude the source product
    return results
      .filter((p) => String(p['_id']) !== String(product._id))
      .slice(0, limit);
  }

  async personalized(profileEmbedding: number[], limit: number): Promise<unknown[]> {
    const pipeline = buildVectorSearchPipeline(profileEmbedding, limit, limit * 10);
    return ProductModel.aggregate(pipeline).exec();
  }

  async frequentlyBoughtTogether(productId: string, limit: number): Promise<unknown[]> {
    const pipeline = buildFrequentlyBoughtTogetherPipeline(productId, limit);
    return OrderModel.aggregate(pipeline).exec();
  }

  async trending(limit: number): Promise<unknown[]> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    return OrderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: since },
          status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          orderCount: { $sum: 1 },
          totalQty: { $sum: '$items.quantity' },
        },
      },
      { $sort: { orderCount: -1, totalQty: -1 } },
      { $limit: limit * 3 }, // over-fetch to survive product join failures
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
          pipeline: [{ $match: { status: 'active', isDeleted: false } }],
        },
      },
      { $unwind: '$product' },
      { $replaceRoot: { newRoot: '$product' } },
      { $limit: limit },
    ]).exec();
  }
}
