import { createHash } from 'node:crypto';

import { Redis } from 'ioredis';

import type { IEmbedder } from './interface.js';

// 7-day TTL matches embedding model staleness window
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

function cacheKey(text: string): string {
  return `emb:${createHash('sha256').update(text).digest('hex')}`;
}

export class CachedEmbedder implements IEmbedder {
  constructor(
    private readonly inner: IEmbedder,
    private readonly redis: Redis,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const results: Array<number[] | null> = Array.from({ length: texts.length }, () => null);
    const misses: Array<{ idx: number; text: string }> = [];

    // Parallel cache lookups
    await Promise.all(
      texts.map(async (text, i) => {
        const cached = await this.redis.get(cacheKey(text));
        if (cached !== null) {
          results[i] = JSON.parse(cached) as number[];
        } else {
          misses.push({ idx: i, text });
        }
      }),
    );

    if (misses.length > 0) {
      const freshEmbeddings = await this.inner.embed(misses.map((m) => m.text));

      await Promise.all(
        misses.map(async (m, i) => {
          const embedding = freshEmbeddings[i];
          if (!embedding) return;
          results[m.idx] = embedding;
          await this.redis.setex(cacheKey(m.text), CACHE_TTL_SECONDS, JSON.stringify(embedding));
        }),
      );
    }

    return results as number[][];
  }
}
