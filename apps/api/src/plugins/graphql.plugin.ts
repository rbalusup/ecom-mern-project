import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ApolloServer } from '@apollo/server';
import { fastifyApolloDrainPlugin, fastifyApolloHandler } from '@as-integrations/fastify';
import { makeExecutableSchema } from '@graphql-tools/schema';

import { createLogger } from '@ecom/observability';

import { typeDefs } from '../graphql/schema/index.js';
import { resolvers } from '../graphql/resolvers/index.js';
import { applyDirectives } from '../graphql/directives/index.js';
import { buildContextFactory } from '../graphql/context.js';
import { loggingPlugin } from '../graphql/plugins/logging.plugin.js';
import { complexityPlugin } from '../graphql/plugins/complexity.plugin.js';
import { getEnv } from '../config/env.js';

export const graphqlPlugin = fp(async (app: FastifyInstance) => {
  const env = getEnv();

  let schema = makeExecutableSchema({ typeDefs, resolvers });
  schema = applyDirectives(schema);

  const logger = createLogger({
    service: env.OTEL_SERVICE_NAME,
    env: env.NODE_ENV,
    level: env.LOG_LEVEL,
  });

  const server = new ApolloServer({
    schema,
    introspection: env.NODE_ENV !== 'production',
    plugins: [
      fastifyApolloDrainPlugin(app),
      loggingPlugin(),
      complexityPlugin(schema, 50),
    ],
    formatError(formattedError) {
      if (env.NODE_ENV === 'production') {
        const { extensions: _ext, ...safe } = formattedError;
        return safe;
      }
      return formattedError;
    },
  });

  await server.start();

  const buildContext = buildContextFactory({ redis: app.redis, logger });

  const handler = fastifyApolloHandler(server, {
    context: async (request: FastifyRequest, reply: FastifyReply) =>
      buildContext({ request, reply }),
  });

  app.route({
    method: ['GET', 'POST'],
    url: '/graphql',
    handler,
  });

  app.log.info('Apollo Server started at /graphql');
}, { name: 'graphql', dependencies: ['mongodb', 'redis'] });
