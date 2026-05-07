import { defaultFieldResolver, type GraphQLSchema } from 'graphql';
import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';

import { RateLimitError } from '@ecom/shared';

import type { GraphQLContext } from '../context.js';

function parseWindow(window: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(window);
  if (!match) throw new Error(`Invalid rateLimit window format: ${window}`);
  const value = parseInt(match[1] ?? '1', 10);
  const unit = match[2];
  if (unit === 's') return value;
  if (unit === 'm') return value * 60;
  if (unit === 'h') return value * 3600;
  return value;
}

export function rateLimitDirectiveTransformer(schema: GraphQLSchema): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      const directive = getDirective(schema, fieldConfig, 'rateLimit')?.[0];
      if (!directive) return fieldConfig;

      const max = directive['max'] as number;
      const windowSeconds = parseWindow(directive['window'] as string);
      const { resolve = defaultFieldResolver } = fieldConfig;

      return {
        ...fieldConfig,
        async resolve(source, args, context: GraphQLContext, info) {
          const identifier =
            context.user?.id ?? context.request.ip ?? 'anonymous';
          const key = `rl:${info.fieldName}:${identifier}`;

          const current = await context.redis.incr(key);
          if (current === 1) {
            // Set TTL on first request
            await context.redis.expire(key, windowSeconds);
          }

          if (current > max) {
            throw new RateLimitError(
              `Rate limit exceeded for ${info.fieldName}. Max ${max} requests per ${directive['window'] as string}.`,
            );
          }

          return resolve(source, args, context, info);
        },
      };
    },
  });
}
