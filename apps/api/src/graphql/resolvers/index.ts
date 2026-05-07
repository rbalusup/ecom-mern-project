import { mergeResolvers } from '@graphql-tools/merge';
import type { IResolvers } from '@graphql-tools/utils';

import { productResolvers } from './product.resolver.js';
import { orderResolvers } from './order.resolver.js';
import { cartResolvers } from './cart.resolver.js';
import { reviewResolvers } from './review.resolver.js';
import { aiResolvers } from './ai.resolver.js';
import { subscriptionResolvers } from './subscription.resolver.js';
import { userResolvers } from './user.resolver.js';
import { categoryResolvers } from './category.resolver.js';

export const resolvers: IResolvers = mergeResolvers([
  productResolvers,
  orderResolvers,
  cartResolvers,
  reviewResolvers,
  aiResolvers,
  subscriptionResolvers,
  userResolvers,
  categoryResolvers,
]);
