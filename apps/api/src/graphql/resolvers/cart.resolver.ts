import type { IResolvers } from '@graphql-tools/utils';

import { CartModel, ProductRepository } from '@ecom/db';
import { NotFoundError, InsufficientStockError } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

const productRepo = new ProductRepository();

async function getOrCreateCart(userId: string) {
  return CartModel.findOneAndUpdate(
    { customerId: userId },
    { $setOnInsert: { customerId: userId, items: [], expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
    { upsert: true, new: true },
  ).exec();
}

function computeCartSubtotal(items: Array<{ quantity: number; unitPrice: { toString(): string } }>): number {
  return items.reduce((sum, item) => sum + item.quantity * parseFloat(item.unitPrice.toString()), 0);
}

export const cartResolvers: IResolvers<any, GraphQLContext> = {
  Query: {
    async cart(_, __, ctx) {
      return CartModel.findOne({ customerId: ctx.user!.id }).lean().exec();
    },
  },

  Mutation: {
    async addToCart(_, { productId, quantity }: { productId: string; quantity: number }, ctx) {
      const product = await productRepo.findByIdOrThrow(productId, 'Product');
      const available = product.inventory.quantity - product.inventory.reservedQuantity;
      if (available < quantity) throw new InsufficientStockError(productId, quantity, available);

      const cart = await CartModel.findOneAndUpdate(
        { customerId: ctx.user!.id, 'items.productId': { $ne: product._id } },
        {
          $push: {
            items: {
              productId: product._id,
              sku: product.sku,
              name: product.name,
              quantity,
              unitPrice: product.price.discountedPrice ?? product.price.base,
              imageUrl: product.images.find((i) => i.isPrimary)?.url,
            },
          },
          $setOnInsert: { customerId: ctx.user!.id },
        },
        { upsert: true, new: true },
      ).exec();

      if (!cart) {
        // Product already in cart — update quantity
        return CartModel.findOneAndUpdate(
          { customerId: ctx.user!.id, 'items.productId': product._id },
          { $inc: { 'items.$.quantity': quantity } },
          { new: true },
        ).lean().exec();
      }
      return cart.toObject();
    },

    async updateCartItem(_, { productId, quantity }: { productId: string; quantity: number }, ctx) {
      if (quantity <= 0) {
        return CartModel.findOneAndUpdate(
          { customerId: ctx.user!.id },
          { $pull: { items: { productId } } },
          { new: true },
        ).lean().exec();
      }
      return CartModel.findOneAndUpdate(
        { customerId: ctx.user!.id, 'items.productId': productId },
        { $set: { 'items.$.quantity': quantity } },
        { new: true },
      ).lean().exec();
    },

    async removeFromCart(_, { productId }: { productId: string }, ctx) {
      return CartModel.findOneAndUpdate(
        { customerId: ctx.user!.id },
        { $pull: { items: { productId } } },
        { new: true },
      ).lean().exec();
    },

    async clearCart(_, __, ctx) {
      return CartModel.findOneAndUpdate(
        { customerId: ctx.user!.id },
        { $set: { items: [], couponId: null } },
        { new: true },
      ).lean().exec();
    },

    async applyCoupon(_, { code }: { code: string }, ctx) {
      const { CouponModel } = await import('@ecom/db');
      const coupon = await CouponModel.findOne({ code: code.toUpperCase(), isActive: true }).lean().exec();
      if (!coupon) throw new NotFoundError('Coupon', code);
      if (coupon.validUntil < new Date()) throw new Error('Coupon has expired');

      return CartModel.findOneAndUpdate(
        { customerId: ctx.user!.id },
        { $set: { couponId: coupon._id } },
        { upsert: true, new: true },
      ).lean().exec();
    },

    async removeCoupon(_, __, ctx) {
      return CartModel.findOneAndUpdate(
        { customerId: ctx.user!.id },
        { $unset: { couponId: 1 } },
        { new: true },
      ).lean().exec();
    },
  },

  Cart: {
    id: (parent) => parent._id.toString(),
    async items(parent, _, ctx) {
      return Promise.all(
        (parent.items as Array<{ productId: { toString(): string }; unitPrice: { toString(): string }; quantity: number } & Record<string, unknown>>).map(async (item) => ({
          ...item,
          product: await ctx.loaders.product.load(item.productId.toString()),
          unitPrice: parseFloat(item.unitPrice.toString()),
          totalPrice: parseFloat(item.unitPrice.toString()) * item.quantity,
        })),
      );
    },
    subtotal(parent) {
      return computeCartSubtotal(parent.items);
    },
    itemCount(parent) {
      return (parent.items as Array<{ quantity: number }>).reduce((sum: number, item) => sum + item.quantity, 0);
    },
  },
};
