import { Redis } from 'ioredis';

import { BedrockEmbedder } from './bedrock.embedder.js';
import { CachedEmbedder } from './cache.js';
import type { IEmbedder } from './interface.js';
import { OpenAIEmbedder } from './openai.embedder.js';

export class EmbedderFactory {
  /**
   * Creates an embedder based on AI_PROVIDER env var ('openai' | 'bedrock').
   * Wraps with Redis cache when a Redis instance is provided.
   */
  static create(redis?: Redis): IEmbedder {
    const provider = process.env['AI_PROVIDER'] ?? 'openai';
    const base: IEmbedder = provider === 'bedrock' ? new BedrockEmbedder() : new OpenAIEmbedder();

    return redis ? new CachedEmbedder(base, redis) : base;
  }
}
