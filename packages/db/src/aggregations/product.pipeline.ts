import type { PipelineStage } from 'mongoose';

export function buildProductSearchPipeline(query: string, limit = 20): PipelineStage[] {
  return [
    {
      $search: {
        index: 'product-text-search',
        compound: {
          should: [
            {
              text: {
                query,
                path: 'name',
                score: { boost: { value: 3 } },
              },
            },
            {
              text: {
                query,
                path: 'tags',
                score: { boost: { value: 2 } },
              },
            },
            {
              text: {
                query,
                path: 'description',
              },
            },
            {
              text: {
                query,
                path: 'aiDescription',
                score: { boost: { value: 1.5 } },
              },
            },
          ],
        },
      },
    },
    { $match: { status: 'active', isDeleted: false } },
    { $limit: limit },
    {
      $addFields: {
        searchScore: { $meta: 'searchScore' },
      },
    },
  ];
}

export function buildVectorSearchPipeline(
  embedding: number[],
  limit = 10,
  numCandidates = 100,
  filters: Record<string, unknown> = {},
): PipelineStage[] {
  return [
    {
      $vectorSearch: {
        index: 'product-vector-search',
        path: 'embedding',
        queryVector: embedding,
        numCandidates,
        limit,
        filter: { status: 'active', isDeleted: false, ...filters },
      },
    } as PipelineStage,
    {
      $addFields: {
        vectorScore: { $meta: 'vectorSearchScore' },
      },
    },
    {
      $match: {
        vectorScore: { $gte: 0.7 }, // minimum cosine similarity threshold
      },
    },
  ];
}

export function buildProductWithCategoryPipeline(productId: string): PipelineStage[] {
  return [
    { $match: { _id: productId } },
    {
      $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'category',
        pipeline: [{ $project: { name: 1, slug: 1, level: 1, path: 1 } }],
      },
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: false } },
  ];
}

export function buildTopRatedProductsPipeline(categoryId?: string, limit = 10): PipelineStage[] {
  const matchStage: PipelineStage = {
    $match: {
      status: 'active',
      isDeleted: false,
      'rating.count': { $gte: 5 },
      ...(categoryId && { categoryId }),
    },
  };

  return [
    matchStage,
    { $sort: { 'rating.average': -1, 'rating.count': -1 } },
    { $limit: limit },
  ];
}

export function buildFrequentlyBoughtTogetherPipeline(productId: string, limit = 5): PipelineStage[] {
  return [
    { $match: { 'items.productId': productId, status: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] } } },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $ne: productId } } },
    { $group: { _id: '$items.productId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
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
  ];
}
