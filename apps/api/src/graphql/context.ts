import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from '@ecom/observability';
import type { UserRole } from '@ecom/shared';
import type { DataLoaders } from './dataloaders/index.js';
import { createDataLoaders } from './dataloaders/index.js';
import { verifyJWT } from '../middleware/auth.middleware.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  cognitoId: string;
}

export interface GraphQLContext {
  user: AuthenticatedUser | null;
  correlationId: string;
  traceId: string | undefined;
  loaders: DataLoaders;
  redis: Redis;
  logger: Logger;
  request: FastifyRequest;
  reply: FastifyReply;
}

interface ContextOptions {
  redis: Redis;
  logger: Logger;
}

export function buildContextFactory(options: ContextOptions) {
  return async function buildContext({
    request,
    reply,
  }: {
    request: FastifyRequest;
    reply: FastifyReply;
  }): Promise<GraphQLContext> {
    const correlationId = (request.id as string | undefined) ?? 'unknown';
    const traceId = request.headers['x-trace-id'] as string | undefined;

    let user: AuthenticatedUser | null = null;
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      user = verifyJWT(token);
    }

    return {
      user,
      correlationId,
      traceId,
      loaders: createDataLoaders(), // fresh per request
      redis: options.redis,
      logger: options.logger.child({ correlationId, userId: user?.id }),
      request,
      reply,
    };
  };
}
