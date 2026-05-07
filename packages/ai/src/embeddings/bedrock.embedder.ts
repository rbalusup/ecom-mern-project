import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

import type { IEmbedder } from './interface.js';

// Titan Text Embeddings V2 — 1536 dimensions
const MODEL_ID = 'amazon.titan-embed-text-v2:0';

interface TitanEmbeddingResponse {
  embedding: number[];
  inputTextTokenCount: number;
}

export class BedrockEmbedder implements IEmbedder {
  private client: BedrockRuntimeClient;

  constructor(region?: string) {
    this.client = new BedrockRuntimeClient({
      region: region ?? process.env['AWS_REGION'] ?? 'us-east-1',
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Bedrock Titan does not support batch embedding — call serially
    const embeddings: number[][] = [];

    for (const text of texts) {
      const body = JSON.stringify({ inputText: text, dimensions: 1536, normalize: true });
      const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: Buffer.from(body),
      });

      const response = await this.client.send(command);
      const result = JSON.parse(Buffer.from(response.body).toString('utf-8')) as TitanEmbeddingResponse;
      embeddings.push(result.embedding);
    }

    return embeddings;
  }
}
