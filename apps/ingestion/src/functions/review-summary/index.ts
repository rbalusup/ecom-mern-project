/**
 * Scheduled Lambda: LLM-based batch review summarization.
 * Runs nightly — finds products with new reviews since last summary
 * and generates/refreshes the reviewSummary field on the Product document.
 *
 * Schedule: EventBridge cron, nightly at 04:00 UTC.
 */

import type { ScheduledHandler } from 'aws-lambda';

import { connectDB, ProductModel, ReviewModel } from '@ecom/db';
import { ReviewSummaryChain } from '@ecom/ai';
import { createLogger, emitEMFMetric, initTracer } from '@ecom/observability';

initTracer({ serviceName: 'ecom-review-summary' });

const logger = createLogger({
  service: 'ecom-review-summary',
  env: process.env['NODE_ENV'] ?? 'production',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

const BATCH_SIZE = 20;
// Only re-summarize products with reviews updated in the last 24h
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

const chain = new ReviewSummaryChain();

export const handler: ScheduledHandler = async () => {
  const mongoUri = process.env['MONGODB_URI'];
  if (!mongoUri) throw new Error('MONGODB_URI not set');
  await connectDB({ uri: mongoUri });

  const since = new Date(Date.now() - REVIEW_WINDOW_MS);

  const productIds = await ReviewModel.distinct('productId', {
    createdAt: { $gte: since },
  }).exec();

  logger.info({ count: productIds.length }, 'Products with new reviews to summarize');

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const batch = productIds.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (productId) => {
        try {
          const reviews = await ReviewModel.find({ productId })
            .select('rating title body')
            .sort({ helpful: -1, createdAt: -1 })
            .limit(50)
            .lean()
            .exec();

          if (reviews.length < 3) return; // Not enough reviews for a meaningful summary

          const summary = await chain.summarize(
            reviews.map((r) => ({
              rating: r.rating,
              title: r.title ?? undefined,
              body: r.body ?? undefined,
            })),
          );

          await ProductModel.findByIdAndUpdate(productId, {
            $set: { reviewSummary: summary },
          }).exec();

          processed++;
          logger.info({ productId, reviewCount: reviews.length }, 'Review summary generated');
        } catch (err) {
          failed++;
          logger.error({ err, productId }, 'Failed to generate review summary');
        }
      }),
    );
  }

  const metricEnv = { env: process.env['NODE_ENV'] ?? 'production' };
  emitEMFMetric('ecom/ingestion', metricEnv, { name: 'ReviewSummaryProcessed', value: processed, unit: 'Count' });
  emitEMFMetric('ecom/ingestion', metricEnv, { name: 'ReviewSummaryFailed', value: failed, unit: 'Count' });

  logger.info({ processed, failed }, 'Review summary Lambda finished');
};
