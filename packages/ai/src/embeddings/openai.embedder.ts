import OpenAI from 'openai';

import type { IEmbedder } from './interface.js';

const BATCH_SIZE = 100;
const DEFAULT_MODEL = 'text-embedding-3-large';
const DIMENSIONS = 1536;

export class OpenAIEmbedder implements IEmbedder {
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model = DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: DIMENSIONS,
      });
      // API returns embeddings in the same order as input
      results.push(...response.data.map((d) => d.embedding));
    }

    return results;
  }
}
