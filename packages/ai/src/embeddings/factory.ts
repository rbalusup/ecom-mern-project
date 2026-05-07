import type { IEmbedder } from './interface.js';

// Stub factory — Phase 4 will wire in OpenAI / Bedrock implementations
export class EmbedderFactory {
  static create(): IEmbedder {
    // Return a mock embedder in Phase 2; replaced with real impl in Phase 4
    return {
      async embed(texts: string[]): Promise<number[][]> {
        // Generate random unit-vector embeddings for testing
        return texts.map(() => {
          const vec = Array.from({ length: 1536 }, () => Math.random() - 0.5);
          const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
          return vec.map((v) => v / norm);
        });
      },
    };
  }
}
