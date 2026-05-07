import type { IResolvers } from '@graphql-tools/utils';

import { CategoryModel, ProductModel } from '@ecom/db';

import type { GraphQLContext } from '../context.js';

const CATEGORY_CACHE_TTL = 1800; // 30 minutes

export const categoryResolvers: IResolvers<any, GraphQLContext> = {
  Query: {
    async categories(_, { parentId }: { parentId?: string }, ctx) {
      const cacheKey = `categories:${parentId ?? 'root'}`;
      const cached = await ctx.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as unknown;

      const filter = parentId ? { parentId, isActive: true } : { parentId: null, isActive: true };
      const categories = await CategoryModel.find(filter).sort({ sortOrder: 1, name: 1 }).lean().exec();
      await ctx.redis.setex(cacheKey, CATEGORY_CACHE_TTL, JSON.stringify(categories));
      return categories;
    },

    async category(_, { id }: { id: string }, ctx) {
      return ctx.loaders.category.load(id);
    },

    async categoryBySlug(_, { slug }: { slug: string }) {
      return CategoryModel.findOne({ slug, isActive: true }).lean().exec();
    },
  },

  Category: {
    id: (parent) => parent._id.toString(),
    async parent(parent, _, ctx) {
      if (!parent.parentId) return null;
      return ctx.loaders.category.load(parent.parentId.toString());
    },
    async children(parent, _, ctx) {
      return ctx.loaders.categoryChildren.load(parent._id.toString());
    },
    async productCount(parent) {
      return ProductModel.countDocuments({ categoryId: parent._id, status: 'active', isDeleted: false });
    },
  },
};
