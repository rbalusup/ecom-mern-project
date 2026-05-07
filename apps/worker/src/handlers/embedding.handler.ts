/**
 * Processes product.embedding.requested events from the ecom-embedding-generator queue.
 *
 * Responsibilities:
 *  - Generate embeddings for product text (name + description + tags)
 *  - Store embedding in MongoDB product.embedding field
 *  - Update embeddingUpdatedAt timestamp
 *  - Skip if cached embedding is recent enough (< 7 days old)
 */

import type { SQSRecord } from 'aws-lambda';

import { ProductModel } from '@ecom/db';
import { EmbedderFactory } from '@ecom/ai';

import { createSQSHandler, type SQSHandlerContext } from '../processors/sqs-base.handler.js';

interface EmbeddingRequestedEvent {
  'detail-type': 'product.embedding.requested';
  detail: {
    productId: string;
    sku: string;
    force?: boolean;
  };
}

const EMBEDDING_STALENESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function processEmbeddingRequest(
  event: EmbeddingRequestedEvent,
  _record: SQSRecord,
  ctx: SQSHandlerContext,
): Promise<void> {
  const { productId, force } = event.detail;

  const product = await ProductModel.findById(productId)
    .select('name description tags attributes embeddingUpdatedAt')
    .lean()
    .exec();

  if (!product) {
    ctx.logger.warn({ productId }, 'Product not found for embedding generation');
    return;
  }

  // Skip if embedding is still fresh (unless forced)
  if (!force && product.embeddingUpdatedAt) {
    const age = Date.now() - new Date(product.embeddingUpdatedAt).getTime();
    if (age < EMBEDDING_STALENESS_MS) {
      ctx.logger.info({ productId, ageMs: age }, 'Embedding still fresh — skipping');
      return;
    }
  }

  const text = [
    product.name,
    product.description ?? '',
    (product.tags ?? []).join(' '),
  ]
    .filter(Boolean)
    .join('\n');

  const embedder = EmbedderFactory.create();
  const results = await embedder.embed([text]);
  const embedding = results[0];
  if (!embedding) {
    ctx.logger.error({ productId }, 'Embedder returned empty result');
    return;
  }

  await ProductModel.findByIdAndUpdate(productId, {
    $set: {
      embedding,
      embeddingModel: process.env['AI_PROVIDER'] === 'bedrock' ? 'titan-v2' : 'text-embedding-3-large',
      embeddingUpdatedAt: new Date(),
    },
  }).exec();

  ctx.logger.info({ productId, dims: embedding?.length }, 'Product embedding updated');
}

export const handler = createSQSHandler<EmbeddingRequestedEvent>(
  'ecom-embedding-generator',
  processEmbeddingRequest,
);
