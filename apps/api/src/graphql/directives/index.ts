import type { GraphQLSchema } from 'graphql';

import { authDirectiveTransformer } from './auth.directive.js';
import { rateLimitDirectiveTransformer } from './rateLimit.directive.js';

export function applyDirectives(schema: GraphQLSchema): GraphQLSchema {
  let s = schema;
  s = authDirectiveTransformer(s);
  s = rateLimitDirectiveTransformer(s);
  return s;
}
