import type { IResolvers } from '@graphql-tools/utils';

import { ProductRepository, UserModel, OrderModel } from '@ecom/db';
import { buildProductSearchPipeline, buildVectorSearchPipeline } from '@ecom/db';
import { NotFoundError } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

const productRepo = new ProductRepository();

const AI_CACHE_TTL = 300; // 5 minutes for semantic search results

export const aiResolvers: IResolvers<any, GraphQLContext> = {
  Query: {
    async semanticSearch(
      _,
      { query, limit = 10 }: { query: string; limit?: number },
      ctx,
    ) {
      const cacheKey = `semantic:${Buffer.from(query).toString('base64url')}:${limit}`;
      const cached = await ctx.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as unknown[];

      // Dynamically import to avoid loading AI packages at cold start if not needed
      const { EmbedderFactory } = await import('@ecom/ai');
      const embedder = EmbedderFactory.create();
      const [embedding] = await embedder.embed([query]);

      const { ProductModel } = await import('@ecom/db');
      const pipeline = buildVectorSearchPipeline(embedding!, limit, Math.max(limit * 10, 100));
      const results = await ProductModel.aggregate(pipeline).exec();

      await ctx.redis.setex(cacheKey, AI_CACHE_TTL, JSON.stringify(results));
      return results;
    },

    async askProduct(
      _,
      { productId, question }: { productId: string; question: string },
      ctx,
    ) {
      const { ProductQAChain } = await import('@ecom/ai');
      const chain = new ProductQAChain();
      const askOpts: { traceId?: string; userId?: string } = {};
      if (ctx.traceId !== undefined) askOpts.traceId = ctx.traceId;
      if (ctx.user?.id !== undefined) askOpts.userId = ctx.user.id;
      const result = await chain.ask(productId, question, askOpts);
      return result;
    },

    async recommendations(
      _,
      { strategy, limit = 10, productId }: { strategy: string; limit?: number; productId?: string },
      ctx,
    ) {
      const { RecommendationChain } = await import('@ecom/ai');
      const chain = new RecommendationChain();

      switch (strategy) {
        case 'SIMILAR_PRODUCTS': {
          if (!productId) throw new Error('productId is required for SIMILAR_PRODUCTS strategy');
          const product = await productRepo.findByIdOrThrow(productId, 'Product');
          const results = await chain.similarProducts(product, limit);
          return { strategy, products: results, score: null };
        }

        case 'PERSONALIZED': {
          const user = await UserModel.findById(ctx.user!.id).select('profileEmbedding').lean().exec();
          if (!user?.profileEmbedding?.length) {
            // Fall back to trending if user has no profile embedding yet
            const trendingResults = await chain.trending(limit);
            return { strategy: 'TRENDING', products: trendingResults, score: null };
          }
          const results = await chain.personalized(user.profileEmbedding, limit);
          return { strategy, products: results, score: null };
        }

        case 'FREQUENTLY_BOUGHT_TOGETHER': {
          if (!productId) throw new Error('productId is required for FREQUENTLY_BOUGHT_TOGETHER strategy');
          const results = await chain.frequentlyBoughtTogether(productId, limit);
          return { strategy, products: results, score: null };
        }

        case 'TRENDING': {
          const results = await chain.trending(limit);
          return { strategy, products: results, score: null };
        }

        default:
          throw new Error(`Unknown recommendation strategy: ${strategy}`);
      }
    },
  },

  Mutation: {
    async generateAIDescription(_, { productId }: { productId: string }, ctx) {
      const product = await productRepo.findByIdOrThrow(productId, 'Product');
      const { DescriptionChain } = await import('@ecom/ai');
      const chain = new DescriptionChain();
      const aiDescription = await chain.generate(product);

      const { ProductModel } = await import('@ecom/db');
      const updated = await ProductModel.findByIdAndUpdate(
        productId,
        { $set: { aiDescription } },
        { new: true },
      )
        .lean()
        .exec();

      if (!updated) throw new NotFoundError('Product', productId);
      return updated;
    },
  },

  AIQueryResult: {
    id: (parent) => parent._id?.toString() ?? parent.id,
  },
};
