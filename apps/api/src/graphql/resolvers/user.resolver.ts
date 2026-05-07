import type { IResolvers } from '@graphql-tools/utils';

import { UserModel } from '@ecom/db';
import { NotFoundError } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

export const userResolvers: IResolvers<any, GraphQLContext> = {
  Query: {
    async me(_, __, ctx) {
      const user = await UserModel.findById(ctx.user!.id).lean().exec();
      if (!user) throw new NotFoundError('User');
      return user;
    },

    async user(_, { id }: { id: string }, ctx) {
      return ctx.loaders.user.load(id);
    },
  },

  Mutation: {
    async updateProfile(_, { input }: { input: Record<string, unknown> }, ctx) {
      const update: Record<string, unknown> = {};
      if (input['firstName']) update['profile.firstName'] = input['firstName'];
      if (input['lastName']) update['profile.lastName'] = input['lastName'];
      if (input['phone']) update['profile.phone'] = input['phone'];
      if (input['preferences']) update['profile.preferences'] = input['preferences'];

      const user = await UserModel.findByIdAndUpdate(ctx.user!.id, { $set: update }, { new: true }).lean().exec();
      if (!user) throw new NotFoundError('User');
      return user;
    },

    async addAddress(_, { input }: { input: Record<string, unknown> }, ctx) {
      const user = await UserModel.findByIdAndUpdate(
        ctx.user!.id,
        { $push: { 'profile.addresses': input } },
        { new: true },
      ).lean().exec();
      if (!user) throw new NotFoundError('User');
      return user;
    },

    async refreshToken(_, { token: _token }: { token: string }) {
      // Token refresh handled by Cognito; stub returns error in production
      throw new Error('Use Cognito token endpoint to refresh tokens');
    },
  },

  User: {
    id: (parent) => parent._id.toString(),
    profile(parent) {
      return {
        ...parent.profile,
        fullName: `${parent.profile.firstName} ${parent.profile.lastName}`,
      };
    },
  },
};
