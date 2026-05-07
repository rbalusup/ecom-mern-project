import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export const redisPlugin = fp(async (app: FastifyInstance) => {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on('error', (err: Error) => {
    app.log.error({ err }, 'Redis error');
  });

  redis.on('connect', () => {
    app.log.info('Redis connected');
  });

  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    await redis.quit();
    app.log.info('Redis disconnected');
  });
}, { name: 'redis' });
