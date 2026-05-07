import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { CachedEmbedder } from './cache.js';
import type { IEmbedder } from './interface.js';
import type { Redis } from 'ioredis';

function cacheKey(text: string): string {
  return `emb:${createHash('sha256').update(text).digest('hex')}`;
}

function mockRedis(store: Map<string, string> = new Map()): Redis {
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, val: string) => { store.set(key, val); return 'OK'; }),
  } as unknown as Redis;
}

function mockInnerEmbedder(embedding: number[] = [1, 2, 3]): IEmbedder {
  return { embed: vi.fn(async (texts: string[]) => texts.map(() => embedding)) };
}

describe('CachedEmbedder', () => {
  it('returns cached embedding without calling inner embedder', async () => {
    const text = 'cached text';
    const stored = [0.1, 0.2, 0.3];
    const store = new Map([[cacheKey(text), JSON.stringify(stored)]]);
    const redis = mockRedis(store);
    const inner = mockInnerEmbedder();

    const cached = new CachedEmbedder(inner, redis);
    const result = await cached.embed([text]);

    expect(result[0]).toEqual(stored);
    expect(inner.embed).not.toHaveBeenCalled();
  });

  it('calls inner embedder on cache miss and stores result', async () => {
    const text = 'uncached text';
    const fresh = [4, 5, 6];
    const store = new Map<string, string>();
    const redis = mockRedis(store);
    const inner = mockInnerEmbedder(fresh);

    const cached = new CachedEmbedder(inner, redis);
    const result = await cached.embed([text]);

    expect(result[0]).toEqual(fresh);
    expect(inner.embed).toHaveBeenCalledWith([text]);
    expect(store.has(cacheKey(text))).toBe(true);
  });

  it('only calls inner embedder for cache misses (mixed batch)', async () => {
    const hit = 'hit text';
    const miss = 'miss text';
    const hitEmbedding = [1, 1, 1];
    const missEmbedding = [2, 2, 2];

    const store = new Map([[cacheKey(hit), JSON.stringify(hitEmbedding)]]);
    const redis = mockRedis(store);
    const inner: IEmbedder = { embed: vi.fn(async () => [missEmbedding]) };

    const cached = new CachedEmbedder(inner, redis);
    const result = await cached.embed([hit, miss]);

    expect(inner.embed).toHaveBeenCalledWith([miss]);
    expect(result[0]).toEqual(hitEmbedding);
    expect(result[1]).toEqual(missEmbedding);
  });

  it('stores embeddings with 7-day TTL', async () => {
    const text = 'ttl test';
    const redis = mockRedis();
    const inner = mockInnerEmbedder([9, 8, 7]);

    const cached = new CachedEmbedder(inner, redis);
    await cached.embed([text]);

    expect(redis.setex).toHaveBeenCalledWith(
      cacheKey(text),
      7 * 24 * 60 * 60,
      expect.any(String),
    );
  });
});
