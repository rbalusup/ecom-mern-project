import type { Redis } from 'ioredis';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Checks Redis SETNX to guard against duplicate SQS message delivery.
 * Returns true if the key was newly set (safe to process), false if already processed.
 */
export async function acquireIdempotencyLock(
  redis: Redis,
  key: string,
): Promise<boolean> {
  const result = await redis.set(
    `idempotency:${key}`,
    '1',
    'EX',
    IDEMPOTENCY_TTL_SECONDS,
    'NX',
  );
  return result === 'OK';
}

export async function releaseIdempotencyLock(
  redis: Redis,
  key: string,
): Promise<void> {
  await redis.del(`idempotency:${key}`);
}
