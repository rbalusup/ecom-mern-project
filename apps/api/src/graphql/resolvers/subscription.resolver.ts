import type { IResolvers } from '@graphql-tools/utils';
import type { GraphQLContext } from '../context.js';

// Subscriptions use Redis pub/sub channels
const ORDER_STATUS_CHANNEL = (orderId: string) => `order:status:${orderId}`;
const INVENTORY_CHANNEL = (productId: string) => `inventory:${productId}`;

export const subscriptionResolvers: IResolvers<any, GraphQLContext> = {
  Subscription: {
    orderStatusChanged: {
      subscribe(_, { orderId }: { orderId: string }, ctx) {
        // Returns an async iterator that yields whenever the Redis channel receives a message.
        // The actual push comes from the worker after processing an order status change event.
        return createRedisAsyncIterator(ctx.redis, ORDER_STATUS_CHANNEL(orderId));
      },
      resolve(payload: unknown) {
        return payload;
      },
    },

    inventoryUpdated: {
      subscribe(_, { productId }: { productId: string }, ctx) {
        return createRedisAsyncIterator(ctx.redis, INVENTORY_CHANNEL(productId));
      },
      resolve(payload: unknown) {
        return payload;
      },
    },
  },
};

// Minimal Redis pub/sub → AsyncIterator bridge.
// In production, use graphql-ws with a proper subscription manager, but
// this thin wrapper covers the contract for the current phase.
function createRedisAsyncIterator(redis: import('ioredis').Redis, channel: string): AsyncIterableIterator<unknown> {
  const subscriber = redis.duplicate();
  const queue: unknown[] = [];
  let resolve: ((value: IteratorResult<unknown>) => void) | null = null;

  subscriber.subscribe(channel);
  subscriber.on('message', (_ch: string, message: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(message); } catch { parsed = message; }
    if (resolve) {
      const r = resolve;
      resolve = null;
      r({ value: parsed, done: false });
    } else {
      queue.push(parsed);
    }
  });

  return {
    next(): Promise<IteratorResult<unknown>> {
      if (queue.length > 0) {
        return Promise.resolve({ value: queue.shift()!, done: false });
      }
      return new Promise((r) => { resolve = r; });
    },
    return(): Promise<IteratorResult<unknown>> {
      subscriber.unsubscribe(channel);
      subscriber.quit();
      return Promise.resolve({ value: undefined, done: true });
    },
    throw(err?: unknown): Promise<IteratorResult<unknown>> {
      subscriber.unsubscribe(channel);
      subscriber.quit();
      return Promise.reject(err);
    },
    [Symbol.asyncIterator](): AsyncIterableIterator<unknown> { return this; },
  };
}
