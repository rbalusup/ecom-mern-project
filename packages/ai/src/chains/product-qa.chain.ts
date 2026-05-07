import { createHash } from 'node:crypto';

import type { Types } from 'mongoose';

import { AIQueryModel, ProductModel, buildVectorSearchPipeline } from '@ecom/db';

import { EmbedderFactory } from '../embeddings/factory.js';
import { LLMFactory } from '../llm/factory.js';
import { buildProductQAPrompt, PRODUCT_QA_SYSTEM_PROMPT } from '../prompts/product-qa.prompt.js';

interface ProductQAOptions {
  traceId?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
}

export interface ProductQAResult {
  answer: string;
  contextProducts: unknown[];
  confidence: number | null;
  latencyMs: number;
  traceId: string;
}

export class ProductQAChain {
  async ask(
    productId: string,
    question: string,
    options: ProductQAOptions = {},
  ): Promise<ProductQAResult> {
    const start = Date.now();
    const traceId =
      options.traceId ??
      createHash('sha256')
        .update(`${productId}:${question}:${start}`)
        .digest('hex')
        .slice(0, 32);
    const sessionId = options.sessionId ?? `session-${traceId}`;

    const embedder = EmbedderFactory.create();
    const llm = LLMFactory.create();

    // 1. Embed the question
    const embedResults = await embedder.embed([question]);
    const queryEmbedding = embedResults[0];
    if (!queryEmbedding) throw new Error('Failed to generate question embedding');

    // 2. Vector search for context — top 5 semantically similar products
    const vectorPipeline = buildVectorSearchPipeline(queryEmbedding, 5, 50);
    const contextProducts: Array<Record<string, unknown>> = await ProductModel.aggregate(vectorPipeline).exec();

    // Ensure the queried product is always in context (prepend if missing)
    const alreadyIncluded = contextProducts.some((p) => String(p['_id']) === productId);
    if (!alreadyIncluded) {
      const specificProduct = await ProductModel.findById(productId).lean().exec();
      if (specificProduct) {
        contextProducts.unshift(specificProduct as unknown as Record<string, unknown>);
      }
    }

    const top5 = contextProducts.slice(0, 5);

    // 3. Build context string for the LLM
    const context = top5
      .map((p) => {
        const attrs =
          p['attributes'] && typeof p['attributes'] === 'object'
            ? Object.entries(p['attributes'] as Record<string, unknown>)
                .map(([k, v]) => `  ${k}: ${String(v)}`)
                .join('\n')
            : '';
        const tags = Array.isArray(p['tags']) ? (p['tags'] as string[]).join(', ') : '';
        return [
          `Product: ${String(p['name'] ?? '')}`,
          `Description: ${String(p['description'] ?? '')}`,
          tags ? `Tags: ${tags}` : '',
          attrs ? `Attributes:\n${attrs}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n---\n\n');

    // 4. Call LLM
    const llmResponse = await llm.complete(
      [
        { role: 'system', content: PRODUCT_QA_SYSTEM_PROMPT },
        { role: 'user', content: buildProductQAPrompt(question, context) },
      ],
      { maxTokens: 512, temperature: 0.2 },
    );

    const latencyMs = Date.now() - start;

    // 5. Persist audit document
    const contextDocs = top5.map((p) => ({
      productId: p['_id'] as Types.ObjectId,
      score: typeof p['vectorScore'] === 'number' ? p['vectorScore'] : 1.0,
      contentSnippet: String(p['description'] ?? '').slice(0, 500),
    }));

    await AIQueryModel.create({
      ...(options.userId !== undefined && { userId: options.userId }),
      sessionId,
      queryType: 'product_qa',
      query: question,
      queryEmbedding,
      contextDocs,
      llmModel: llmResponse.model,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
      latencyMs,
      response: llmResponse.content,
      traceId,
    });

    return {
      answer: llmResponse.content,
      contextProducts: top5,
      confidence: null,
      latencyMs,
      traceId,
    };
  }
}
