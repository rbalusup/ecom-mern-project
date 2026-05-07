import type { IResolvers } from '@graphql-tools/utils';

import { ProductModel, ProductRepository, buildProductSearchPipeline } from '@ecom/db';
import { NotFoundError } from '@ecom/shared';
import { buildConnection } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

const productRepo = new ProductRepository();

const PRODUCT_CACHE_TTL = 300; // 5 minutes

export const productResolvers: IResolvers<any, GraphQLContext> = {
  Query: {
    async product(_, { id }: { id: string }, ctx) {
      const cacheKey = `product:${id}`;
      const cached = await ctx.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as unknown;

      const product = await productRepo.findByIdOrThrow(id, 'Product');
      await ctx.redis.setex(cacheKey, PRODUCT_CACHE_TTL, JSON.stringify(product));
      return product;
    },

    async productBySku(_, { sku }: { sku: string }, ctx) {
      const product = await productRepo.findBySku(sku);
      if (!product) throw new NotFoundError('Product', sku);
      return product;
    },

    async productBySlug(_, { slug }: { slug: string }, ctx) {
      const product = await productRepo.findBySlug(slug);
      if (!product) throw new NotFoundError('Product', slug);
      return product;
    },

    async products(_, args: { filter?: Record<string, unknown>; first?: number; after?: string }) {
      return productRepo.findWithFilters(args.filter ?? {}, {
        first: args.first,
        after: args.after,
      });
    },

    async searchProducts(_, { query, first, after }: { query: string; first?: number; after?: string }) {
      const limit = Math.min(first ?? 20, 50);
      const pipeline = buildProductSearchPipeline(query, limit);
      const docs = await ProductModel.aggregate(pipeline);
      const total = docs.length;
      return buildConnection(docs, total, (d) => d._id.toString(), false);
    },
  },

  Mutation: {
    async createProduct(_, { input }: { input: Record<string, unknown> }, ctx) {
      const slug = (input['name'] as string).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const product = await productRepo.create({
        ...input,
        slug,
        vendorId: ctx.user!.id,
        status: (input['status'] as string) ?? 'draft',
      } as unknown as Parameters<typeof productRepo.create>[0]);
      return product;
    },

    async updateProduct(_, { id, input }: { id: string; input: Record<string, unknown> }, ctx) {
      const product = await productRepo.updateById(id, { $set: input });
      if (!product) throw new NotFoundError('Product', id);
      await ctx.redis.del(`product:${id}`);
      return product;
    },

    async generateAIDescription(_, { productId }: { productId: string }, ctx) {
      const product = await productRepo.findByIdOrThrow(productId, 'Product');
      // AI description generation is handled via the ai.resolver — stub here
      ctx.logger.info({ productId }, 'AI description generation requested');
      return product;
    },
  },

  Product: {
    id: (parent) => parent._id.toString(),
    async category(parent, _, ctx) {
      return ctx.loaders.category.load(parent.categoryId.toString());
    },
    async vendor(parent, _, ctx) {
      return ctx.loaders.user.load(parent.vendorId.toString());
    },
    price(parent) {
      const base = parseFloat(parent.price.base.toString());
      const discountedPrice = parent.price.discountedPrice
        ? parseFloat(parent.price.discountedPrice.toString())
        : undefined;
      return {
        base,
        currency: parent.price.currency,
        discountedPrice,
        effectivePrice: discountedPrice ?? base,
      };
    },
    inventory(parent) {
      const { quantity, reservedQuantity, warehouseId, lowStockThreshold } = parent.inventory;
      const available = Math.max(0, quantity - reservedQuantity);
      return {
        quantity,
        reservedQuantity,
        availableQuantity: available,
        warehouseId,
        lowStockThreshold,
        isLowStock: available <= lowStockThreshold && available > 0,
        isInStock: available > 0,
      };
    },
    attributes(parent) {
      if (parent.attributes instanceof Map) {
        return Object.fromEntries(parent.attributes);
      }
      return parent.attributes ?? {};
    },
    async reviews(parent, { first, after }: { first?: number; after?: string }, _ctx: GraphQLContext) {
      const { ReviewModel } = await import('@ecom/db');
      const limit = Math.min(first ?? 10, 50);
      const filter: Record<string, unknown> = { productId: parent._id, isDeleted: false };
      if (after) filter['_id'] = { $gt: after };

      const [reviews, total] = await Promise.all([
        ReviewModel.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean(),
        ReviewModel.countDocuments({ productId: parent._id, isDeleted: false }),
      ]);

      const hasNext = reviews.length > limit;
      const nodes = hasNext ? reviews.slice(0, limit) : reviews;
      const summary = await ReviewModel.aggregate<{ averageRating: number }>([
        { $match: { productId: parent._id, isDeleted: false } },
        { $group: { _id: null, averageRating: { $avg: '$rating' } } },
      ]);

      return {
        edges: nodes.map((r) => ({ node: r, cursor: r._id.toString() })),
        pageInfo: {
          hasNextPage: hasNext,
          hasPreviousPage: !!after,
          ...(nodes[0] && { startCursor: nodes[0]._id.toString() }),
          ...(nodes[nodes.length - 1] && { endCursor: nodes[nodes.length - 1]!._id.toString() }),
        },
        totalCount: total,
        averageRating: summary[0]?.averageRating ?? 0,
      };
    },
  },
};
