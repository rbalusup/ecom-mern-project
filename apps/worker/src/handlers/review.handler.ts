/**
 * Processes review.created events.
 *
 * Responsibilities:
 *  - Trigger async LLM review summarization per product
 *  - Update product rating aggregation
 *  - Forward review event to Kafka ecom.product.events
 */

import type { SQSRecord } from 'aws-lambda';

import { ReviewModel, ProductModel } from '@ecom/db';
import { createSQSHandler, type SQSHandlerContext } from '../processors/sqs-base.handler.js';
import { KafkaProducer } from '../kafka/producer.js';

interface ReviewCreatedEvent {
  'detail-type': 'review.created';
  detail: {
    reviewId: string;
    productId: string;
    customerId: string;
    rating: number;
  };
}

async function processReviewEvent(
  event: ReviewCreatedEvent,
  _record: SQSRecord,
  ctx: SQSHandlerContext,
): Promise<void> {
  const { reviewId, productId, rating } = event.detail;
  ctx.logger.info({ reviewId, productId, rating }, 'Processing review.created event');

  // Aggregate rating for the product
  const [agg] = await ReviewModel.aggregate<{ avg: number; count: number }>([
    { $match: { productId } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]).exec();

  if (agg) {
    await ProductModel.findByIdAndUpdate(productId, {
      $set: { 'rating.average': Math.round(agg.avg * 10) / 10, 'rating.count': agg.count },
    }).exec();
    ctx.logger.info({ productId, avg: agg.avg, count: agg.count }, 'Product rating updated');
  }

  // Publish to Kafka AI telemetry — review summary job picks this up
  await KafkaProducer.publish('ecom.product.events', {
    key: productId,
    value: JSON.stringify({ type: 'REVIEW_CREATED', reviewId, productId }),
    headers: { traceId: ctx.traceId ?? '' },
  });

  // Queue LLM review summary via EventBridge if review count milestone reached
  if (agg && agg.count % 10 === 0) {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eb = new EventBridgeClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: `ecom-genai-${process.env['NODE_ENV'] ?? 'dev'}`,
        Source: 'ecom.review',
        DetailType: 'review.summary.requested',
        Detail: JSON.stringify({ productId, reviewCount: agg.count }),
      }],
    }));
    ctx.logger.info({ productId }, 'Queued review summary generation');
  }
}

export const handler = createSQSHandler<ReviewCreatedEvent>('ecom-review-processor', processReviewEvent);
