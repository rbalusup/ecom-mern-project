import type { ApolloServerPlugin, GraphQLRequestContext } from '@apollo/server';
import { recordResolverLatency } from '@ecom/observability';
import type { GraphQLContext } from '../context.js';

export function loggingPlugin(): ApolloServerPlugin<GraphQLContext> {
  return {
    requestDidStart(requestContext) {
      const start = Date.now();
      const { request } = requestContext;

      return Promise.resolve({
        willSendResponse({ contextValue, response }: GraphQLRequestContext<GraphQLContext>) {
          const durationMs = Date.now() - start;
          const operationName = request.operationName ?? 'anonymous';
          const body = response.body;
          const hasErrors =
            body !== undefined &&
            body.kind === 'single' &&
            !!(body.singleResult.errors?.length);

          contextValue.logger.info(
            { operationName, durationMs, hasErrors },
            'GraphQL operation completed',
          );

          recordResolverLatency(durationMs, {
            env: process.env['NODE_ENV'] ?? 'development',
            resolverName: operationName,
            success: hasErrors ? 'false' : 'true',
          });

          return Promise.resolve();
        },

        didEncounterErrors({ contextValue, errors }: GraphQLRequestContext<GraphQLContext>) {
          contextValue.logger.warn({ errors }, 'GraphQL errors encountered');
          return Promise.resolve();
        },
      });
    },
  };
}
