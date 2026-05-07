import DataLoader from 'dataloader';

import { ReviewModel, type IReviewDocument } from '@ecom/db';

// Loads a summary (average + count) for a list of product IDs in one query
export interface ReviewSummary {
  averageRating: number;
  count: number;
}

export function createReviewSummaryLoader(): DataLoader<string, ReviewSummary> {
  return new DataLoader<string, ReviewSummary>(
    async (productIds) => {
      const results = await ReviewModel.aggregate<{
        _id: string;
        averageRating: number;
        count: number;
      }>([
        { $match: { productId: { $in: productIds }, isDeleted: false } },
        {
          $group: {
            _id: { $toString: '$productId' },
            averageRating: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ]);

      const map = new Map(results.map((r) => [r._id, { averageRating: r.averageRating, count: r.count }]));
      return productIds.map((id) => map.get(id) ?? { averageRating: 0, count: 0 });
    },
    { cache: true, maxBatchSize: 50 },
  );
}

export function createProductReviewsLoader(): DataLoader<string, IReviewDocument[]> {
  return new DataLoader<string, IReviewDocument[]>(
    async (productIds) => {
      const reviews = await ReviewModel.find({
        productId: { $in: productIds },
        isDeleted: false,
      })
        .sort({ createdAt: -1 })
        .limit(productIds.length * 5)
        .lean<IReviewDocument[]>()
        .exec();

      const map = new Map<string, IReviewDocument[]>();
      for (const review of reviews) {
        const pid = review.productId.toString();
        const existing = map.get(pid) ?? [];
        existing.push(review);
        map.set(pid, existing);
      }
      return productIds.map((id) => map.get(id) ?? []);
    },
    { cache: true, maxBatchSize: 50 },
  );
}
