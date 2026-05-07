import { defaultFieldResolver, type GraphQLSchema } from 'graphql';
import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';

import { ForbiddenError, UnauthorizedError } from '@ecom/shared';
import type { UserRole } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  customer: 1,
  vendor: 2,
  admin: 3,
};

function hasRequiredRole(userRole: UserRole, requiredRoles: UserRole[]): boolean {
  if (requiredRoles.length === 0) return true; // @auth with no roles = any authenticated user
  return requiredRoles.some((r) => ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[r]);
}

export function authDirectiveTransformer(schema: GraphQLSchema): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      const directive = getDirective(schema, fieldConfig, 'auth')?.[0];
      if (!directive) return fieldConfig;

      const requiredRoles = ((directive['roles'] as string[] | undefined) ?? []).map(
        (r) => r.toLowerCase() as UserRole,
      );

      const { resolve = defaultFieldResolver } = fieldConfig;

      return {
        ...fieldConfig,
        resolve(source, args, context: GraphQLContext, info) {
          if (!context.user) {
            throw new UnauthorizedError('You must be logged in to access this resource');
          }
          if (!hasRequiredRole(context.user.role, requiredRoles)) {
            throw new ForbiddenError(
              `This action requires role: ${requiredRoles.join(' or ')}`,
            );
          }
          return resolve(source, args, context, info);
        },
      };
    },
  });
}
