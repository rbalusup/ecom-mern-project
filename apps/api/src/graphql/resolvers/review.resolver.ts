import type { IResolvers } from '@graphql-tools/utils';

import { ReviewModel, ProductModel, OrderModel } from '@ecom/db';
import { NotFoundError, ConflictError, ForbiddenError } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

export const reviewResolvers: IResolvers<any, GraphQLContext> = {
  Query: {
    async productReviews(_, { productId, first = 10, after }: { productId: string; first?: number; after?: string }, ctx) {
      const limit = Math.min(first, 50);
      const filter: Record<string, unknown> = { productId };

      if (after) {
        const decoded = Buffer.from(after, 'base64url').toString('utf8');
        filter['_id'] = { $lt: decoded };
      }

      const reviews = await ReviewModel.find(filter)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean()
        .exec();

      const hasNextPage = reviews.length > limit;
      const edges = reviews.slice(0, limit).map((r) => ({
        node: r,
        cursor: Buffer.from(r._id.toString()).toString('base64url'),
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!after,
          ...(edges[0] && { startCursor: edges[0].cursor }),
          ...(edges[edges.length - 1] && { endCursor: edges[edges.length - 1]!.cursor }),
        },
        totalCount: await ReviewModel.countDocuments({ productId }),
      };
    },

    async myReviews(_, { first = 10, after }: { first?: number; after?: string }, ctx) {
      const limit = Math.min(first, 50);
      const filter: Record<string, unknown> = { customerId: ctx.user!.id };

      if (after) {
        const decoded = Buffer.from(after, 'base64url').toString('utf8');
        filter['_id'] = { $lt: decoded };
      }

      const reviews = await ReviewModel.find(filter)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean()
        .exec();

      const hasNextPage = reviews.length > limit;
      const edges = reviews.slice(0, limit).map((r) => ({
        node: r,
        cursor: Buffer.from(r._id.toString()).toString('base64url'),
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!after,
          ...(edges[0] && { startCursor: edges[0].cursor }),
          ...(edges[edges.length - 1] && { endCursor: edges[edges.length - 1]!.cursor }),
        },
        totalCount: await ReviewModel.countDocuments({ customerId: ctx.user!.id }),
      };
    },
  },

  Mutation: {
    async createReview(
      _,
      { productId, rating, title, body }: { productId: string; rating: number; title: string; body?: string },
      ctx,
    ) {
      const product = await ProductModel.findById(productId).lean().exec();
      if (!product) throw new NotFoundError('Product', productId);

      const existing = await ReviewModel.findOne({ productId, customerId: ctx.user!.id }).lean().exec();
      if (existing) throw new ConflictError('Review', `${ctx.user!.id}/${productId}`);

      const verifiedPurchase = !!(await OrderModel.findOne({
        customerId: ctx.user!.id,
        'items.productId': productId,
        status: 'delivered',
      })
        .lean()
        .exec());

      const review = await ReviewModel.create({
        productId,
        customerId: ctx.user!.id,
        rating,
        title,
        body,
        verifiedPurchase,
      });

      // Update product rating asynchronously
      ReviewModel.aggregate([
        { $match: { productId: review.productId } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
        .exec()
        .then(([result]) => {
          if (result) {
            ProductModel.updateOne(
              { _id: productId },
              { $set: { 'rating.average': result.avg, 'rating.count': result.count } },
            ).exec();
          }
        })
        .catch(() => {});

      return review.toObject();
    },

    async updateReview(
      _,
      { reviewId, rating, title, body }: { reviewId: string; rating?: number; title?: string; body?: string },
      ctx,
    ) {
      const review = await ReviewModel.findById(reviewId).lean().exec();
      if (!review) throw new NotFoundError('Review', reviewId);
      if (review.customerId.toString() !== ctx.user!.id) {
        throw new ForbiddenError('You can only edit your own reviews');
      }

      const update: Record<string, unknown> = {};
      if (rating !== undefined) update['rating'] = rating;
      if (title !== undefined) update['title'] = title;
      if (body !== undefined) update['body'] = body;

      return ReviewModel.findByIdAndUpdate(reviewId, { $set: update }, { new: true }).lean().exec();
    },

    async deleteReview(_, { reviewId }: { reviewId: string }, ctx) {
      const review = await ReviewModel.findById(reviewId).lean().exec();
      if (!review) throw new NotFoundError('Review', reviewId);

      const isOwner = review.customerId.toString() === ctx.user!.id;
      const isAdmin = ctx.user!.role === 'admin';
      if (!isOwner && !isAdmin) throw new ForbiddenError('You can only delete your own reviews');

      await ReviewModel.deleteOne({ _id: reviewId }).exec();
      return true;
    },

    async markReviewHelpful(_, { reviewId }: { reviewId: string }, ctx) {
      const review = await ReviewModel.findByIdAndUpdate(
        reviewId,
        { $inc: { 'helpful.count': 1 } },
        { new: true },
      )
        .lean()
        .exec();
      if (!review) throw new NotFoundError('Review', reviewId);
      return review;
    },
  },

  Review: {
    id: (parent) => parent._id.toString(),
    async author(parent, _, ctx) {
      return ctx.loaders.user.load(parent.customerId.toString());
    },
    async product(parent, _, ctx) {
      return ctx.loaders.product.load(parent.productId.toString());
    },
  },
};
