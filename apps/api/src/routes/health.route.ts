import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const mongoState = mongoose.connection.readyState;
    const mongoOk = mongoState === 1;

    let redisOk = false;
    try {
      const pong = await app.redis.ping();
      redisOk = pong === 'PONG';
    } catch {
      redisOk = false;
    }

    const healthy = mongoOk && redisOk;
    const status = healthy ? 'ok' : 'degraded';

    return reply.status(healthy ? 200 : 503).send({
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        mongodb: mongoOk ? 'ok' : 'down',
        redis: redisOk ? 'ok' : 'down',
      },
    });
  });

  app.get('/health/ready', async (_request, reply) => {
    return reply.status(200).send({ status: 'ready' });
  });

  app.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'alive' });
  });
}
