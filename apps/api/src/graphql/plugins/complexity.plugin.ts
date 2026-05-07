import { type GraphQLSchema, separateOperations } from 'graphql';
import { fieldExtensionsEstimator, simpleEstimator, getComplexity } from 'graphql-query-complexity';
import type { ApolloServerPlugin, GraphQLRequestContext } from '@apollo/server';

import type { GraphQLContext } from '../context.js';

export function complexityPlugin(schema: GraphQLSchema, maxComplexity: number): ApolloServerPlugin<GraphQLContext> {
  return {
    requestDidStart() {
      return Promise.resolve({
        didResolveOperation({ request, document }: GraphQLRequestContext<GraphQLContext>) {
          if (!document) return Promise.resolve();
          const query = request.operationName
            ? separateOperations(document)[request.operationName]
            : document;

          if (!query) return Promise.resolve();

          const complexity = getComplexity({
            schema,
            query,
            variables: request.variables ?? {},
            estimators: [
              fieldExtensionsEstimator(),
              simpleEstimator({ defaultComplexity: 1 }),
            ],
          });

          if (complexity > maxComplexity) {
            return Promise.reject(
              new Error(
                `Query complexity ${complexity} exceeds maximum allowed complexity ${maxComplexity}`,
              ),
            );
          }

          return Promise.resolve();
        },
      });
    },
  };
}
