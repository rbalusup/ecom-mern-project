/**
 * Standalone backfill script — CLI counterpart to the embedding-backfill Lambda.
 * Processes products missing or stale embeddings using a Redis cursor checkpoint.
 *
 * Usage:
 *   pnpm backfill
 *   AI_PROVIDER=bedrock pnpm backfill    # use Bedrock Titan embedder
 *   pnpm backfill --reset               # clear Redis checkpoint and restart
 *
 * Env vars: MONGODB_URI, REDIS_URL, OPENAI_API_KEY / AWS credentials, AI_PROVIDER
 */

import { Redis } from 'ioredis';
import { connectDB, ProductModel } from '@ecom/db';
import { EmbedderFactory } from '@ecom/ai';

const BATCH_SIZE = 50;
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const CHECKPOINT_KEY = 'backfill:embedding:checkpoint';

async function main() {
  const mongoUri = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/ecom';
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const resetCheckpoint = process.argv.includes('--reset');

  console.log('Connecting to MongoDB and Redis…');
  await connectDB({ uri: mongoUri });
  const redis = new Redis(redisUrl);

  if (resetCheckpoint) {
    await redis.del(CHECKPOINT_KEY);
    console.log('Checkpoint cleared — starting from the beginning.');
  }

  const embedder = EmbedderFactory.create();
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  let checkpoint = await redis.get(CHECKPOINT_KEY);
  let totalProcessed = 0;
  let totalSkipped = 0;
  const startTime = Date.now();

  console.log(`Checkpoint: ${checkpoint ?? 'none (full scan)'}`);
  console.log(`Embedder: AI_PROVIDER=${process.env['AI_PROVIDER'] ?? 'openai'}`);
  console.log('');

  while (true) {
    const filter: Record<string, unknown> = {
      $or: [
        { embeddingUpdatedAt: { $exists: false } },
        { embeddingUpdatedAt: { $lt: staleThreshold } },
      ],
    };
    if (checkpoint) {
      filter['_id'] = { $gt: checkpoint };
    }

    const products = await ProductModel.find(filter)
      .select('_id name description tags')
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean()
      .exec();

    if (products.length === 0) {
      console.log(`\n✅ Backfill complete — ${totalProcessed} products embedded, ${totalSkipped} already up-to-date.`);
      await redis.del(CHECKPOINT_KEY);
      break;
    }

    const texts = products.map((p) =>
      [p.name, p.description ?? '', (p.tags ?? []).join(' ')].filter(Boolean).join('\n'),
    );

    const embeddings = await embedder.embed(texts);

    const bulkOps = products.map((p, i) => ({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            embedding: embeddings[i],
            embeddingModel: process.env['AI_PROVIDER'] === 'bedrock' ? 'titan-v2' : 'text-embedding-3-large',
            embeddingUpdatedAt: new Date(),
          },
        },
      },
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ProductModel.bulkWrite(bulkOps as any);
    totalProcessed += products.length;

    const lastId = products[products.length - 1]!._id.toString();
    await redis.set(CHECKPOINT_KEY, lastId);
    checkpoint = lastId;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`  Embedded batch of ${products.length} (total: ${totalProcessed}, ${elapsed}s elapsed)\r`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Total time: ${elapsed}s`);

  await redis.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
