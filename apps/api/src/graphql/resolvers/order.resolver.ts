import type { IResolvers } from '@graphql-tools/utils';

import { OrderRepository, OrderEventModel, ProductRepository } from '@ecom/db';
import { NotFoundError, InsufficientStockError, InvalidOrderTransitionError, generateOrderNumber, generateIdempotencyKey, ORDER_TRANSITIONS } from '@ecom/shared';
import type { OrderStatus } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

const orderRepo = new OrderRepository();
const productRepo = new ProductRepository();

export const orderResolvers: IResolvers<any, GraphQLContext> = {
  Query: {
    async order(_, { id }: { id: string }, ctx) {
      const order = await orderRepo.findByIdOrThrow(id, 'Order');
      // Customers can only see their own orders
      if (ctx.user!.role === 'customer' && order.customerId.toString() !== ctx.user!.id) {
        throw new NotFoundError('Order', id);
      }
      return order;
    },

    async myOrders(_, args: { first?: number; after?: string; filter?: Record<string, unknown> }, ctx) {
      return orderRepo.findWithFilters(
        { ...args.filter, customerId: ctx.user!.id },
        { first: args.first, after: args.after },
      );
    },

    async orders(_, args: { filter?: Record<string, unknown>; first?: number; after?: string }) {
      return orderRepo.findWithFilters(args.filter ?? {}, {
        first: args.first,
        after: args.after,
      });
    },
  },

  Mutation: {
    async createOrder(
      _,
      { input }: { input: { items: Array<{ productId: string; quantity: number }>; shippingAddress: Record<string, unknown>; couponCode?: string; notes?: string } },
      ctx,
    ) {
      // Validate and reserve inventory
      const orderItems = [];
      let subtotal = 0;

      for (const item of input.items) {
        const product = await productRepo.findByIdOrThrow(item.productId, 'Product');
        const available = product.inventory.quantity - product.inventory.reservedQuantity;

        if (available < item.quantity) {
          throw new InsufficientStockError(item.productId, item.quantity, available);
        }

        const unitPrice = parseFloat(product.price.discountedPrice?.toString() ?? product.price.base.toString());
        const totalPrice = unitPrice * item.quantity;
        subtotal += totalPrice;

        // Decrement inventory atomically
        const updated = await productRepo.decrementInventory(item.productId, item.quantity);
        if (!updated) throw new InsufficientStockError(item.productId, item.quantity, 0);

        orderItems.push({
          productId: product._id,
          sku: product.sku,
          name: product.name,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          imageUrl: product.images.find((i) => i.isPrimary)?.url,
        });
      }

      const tax = subtotal * 0.08; // 8% tax (simplified)
      const shipping = subtotal >= 50 ? 0 : 9.99;
      const total = subtotal + tax + shipping;
      const orderCount = await orderRepo.count();
      const orderNumber = generateOrderNumber(new Date(), orderCount + 1);

      const order = await orderRepo.create({
        orderNumber,
        customerId: ctx.user!.id,
        status: 'pending_payment' as OrderStatus,
        items: orderItems,
        pricing: {
          subtotal,
          tax,
          shipping,
          discount: 0,
          total,
          currency: 'USD',
        },
        shippingAddress: input.shippingAddress,
        paymentMethod: { type: 'card', provider: 'stripe' },
        notes: input.notes,
        metadata: new Map(),
      } as unknown as Parameters<typeof orderRepo.create>[0]);

      // Publish event to EventBridge (non-blocking)
      void publishOrderCreated(order._id.toString(), ctx).catch((err) =>
        ctx.logger.error({ err }, 'Failed to publish order.created event'),
      );

      return order;
    },

    async cancelOrder(_, { id }: { id: string }, ctx) {
      const order = await orderRepo.findByIdOrThrow(id, 'Order');
      if (ctx.user!.role === 'customer' && order.customerId.toString() !== ctx.user!.id) {
        throw new NotFoundError('Order', id);
      }
      return orderRepo.transitionStatus(id, 'cancelled', ctx.user!.id, { reason: 'customer_cancel' });
    },

    async updateOrderStatus(_, { id, input }: { id: string; input: { status: string; notes?: string } }, ctx) {
      const statusMap: Record<string, OrderStatus> = {
        CONFIRMED: 'confirmed',
        PROCESSING: 'processing',
        SHIPPED: 'shipped',
        DELIVERED: 'delivered',
        CANCELLED: 'cancelled',
        RETURN_REQUESTED: 'return_requested',
        RETURNED: 'returned',
      };
      const toStatus = statusMap[input.status];
      if (!toStatus) throw new InvalidOrderTransitionError(input.status, input.status);
      return orderRepo.transitionStatus(id, toStatus, ctx.user!.id, { notes: input.notes });
    },
  },

  Order: {
    id: (parent) => parent._id.toString(),
    async customer(parent, _, ctx) {
      return ctx.loaders.user.load(parent.customerId.toString());
    },
    async events(parent) {
      return OrderEventModel.find({ orderId: parent._id }).sort({ timestamp: 1 }).lean().exec();
    },
    canCancel(parent) {
      return ORDER_TRANSITIONS[parent.status as OrderStatus]?.includes('cancelled') ?? false;
    },
    pricing(parent) {
      const p = parent.pricing;
      return {
        subtotal: parseFloat(p.subtotal.toString()),
        tax: parseFloat(p.tax.toString()),
        shipping: parseFloat(p.shipping.toString()),
        discount: parseFloat(p.discount.toString()),
        total: parseFloat(p.total.toString()),
        currency: p.currency,
      };
    },
    async items(parent, _, ctx) {
      return Promise.all(
        (parent.items as Array<{ productId: { toString(): string }; unitPrice: { toString(): string }; totalPrice: { toString(): string } } & Record<string, unknown>>).map(async (item) => ({
          ...item,
          product: await ctx.loaders.product.load(item.productId.toString()),
          unitPrice: parseFloat(item.unitPrice.toString()),
          totalPrice: parseFloat(item.totalPrice.toString()),
        })),
      );
    },
  },

  OrderEvent: {
    id: (parent) => parent._id.toString(),
  },
};

async function publishOrderCreated(orderId: string, ctx: GraphQLContext): Promise<void> {
  const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
  const env = (await import('../../config/env.js')).getEnv();

  const client = new EventBridgeClient({
    region: env.AWS_REGION,
    ...(env.AWS_ENDPOINT_URL && { endpoint: env.AWS_ENDPOINT_URL }),
  });

  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: env.EVENTBRIDGE_BUS_NAME,
          Source: 'com.ecom.genai',
          DetailType: 'order.created',
          Detail: JSON.stringify({ orderId }),
        },
      ],
    }),
  );
}
