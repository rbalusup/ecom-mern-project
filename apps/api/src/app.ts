import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import { createLogger } from '@ecom/observability';

import { getEnv } from './config/env.js';
import { mongodbPlugin } from './plugins/mongodb.plugin.js';
import { redisPlugin } from './plugins/redis.plugin.js';
import { telemetryPlugin } from './plugins/telemetry.plugin.js';
import { graphqlPlugin } from './plugins/graphql.plugin.js';
import { healthRoutes } from './routes/health.route.js';
import { jsonRpcRoutes } from './routes/jsonrpc.route.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();
  const logger = createLogger({
    service: env.OTEL_SERVICE_NAME,
    env: env.NODE_ENV,
    level: env.LOG_LEVEL,
  });

  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? false : true, // use Pino directly in prod
    disableRequestLogging: true,
    trustProxy: true,
    requestIdLogLabel: 'correlationId',
    requestIdHeader: 'x-correlation-id',
  });

  // ─── Telemetry (must register before routes) ──────────────────────────────
  await app.register(telemetryPlugin, { logger });

  // ─── CORS ────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'traceparent'],
  });

  // ─── Database connections ─────────────────────────────────────────────────
  await app.register(mongodbPlugin, {
    uri: env.MONGODB_URI,
    dbName: env.MONGODB_DB_NAME,
  });

  await app.register(redisPlugin, {
    url: env.REDIS_URL,
    tls: env.REDIS_TLS,
  });

  // ─── Routes ───────────────────────────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(jsonRpcRoutes, { prefix: '/rpc' });

  // ─── GraphQL (Apollo Server 4 via Fastify integration) ───────────────────
  await app.register(graphqlPlugin);

  // ─── Error handler ────────────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, correlationId: request.id }, 'Unhandled error');
    void reply.status(error.statusCode ?? 500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  return app;
}
