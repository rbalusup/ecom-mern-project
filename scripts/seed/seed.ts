/**
 * Seed script — populates the database with realistic test data.
 *
 * Usage:
 *   pnpm seed                        # mock embeddings (fast, no API cost)
 *   SEED_EMBEDDINGS=real pnpm seed   # real OpenAI embeddings (~$0.02)
 *   MONGODB_URI=... pnpm seed        # custom DB connection
 */

import { connectDB } from '@ecom/db';
import { seedCategories } from './generators/category.generator.js';
import { seedProducts } from './generators/product.generator.js';
import { seedUsers } from './generators/user.generator.js';
import { seedCoupons } from './generators/coupon.generator.js';
import { seedOrders } from './generators/order.generator.js';
import { seedReviews } from './generators/review.generator.js';

async function main() {
  const mongoUri = process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017/ecom';
  console.log(`Connecting to MongoDB: ${mongoUri.replace(/\/\/[^@]*@/, '//<redacted>@')}`);
  await connectDB({ uri: mongoUri });

  const start = Date.now();
  console.log('\n🌱 Starting seed…\n');

  // 1. Categories (10)
  process.stdout.write('  Categories… ');
  const categories = await seedCategories();
  console.log(`✓ ${categories.length} categories`);

  // 2. Products (50, 5 per leaf category)
  process.stdout.write('  Products… ');
  const productIds = await seedProducts(categories);
  console.log(`✓ ${productIds.length} products`);

  // 3. Users (100)
  process.stdout.write('  Users… ');
  const users = await seedUsers();
  console.log(`✓ ${users.length} users (${users.filter((u) => u.role === 'admin').length} admin, ${users.filter((u) => u.role === 'vendor').length} vendor, ${users.filter((u) => u.role === 'customer').length} customer)`);

  // 4. Coupons (20)
  process.stdout.write('  Coupons… ');
  const couponIds = await seedCoupons();
  console.log(`✓ ${couponIds.length} coupons`);

  // 5. Orders (200)
  process.stdout.write('  Orders… ');
  const userIds = users.map((u) => u._id);
  const orders = await seedOrders(userIds, productIds);
  console.log(`✓ ${orders.length} orders (${orders.filter((o) => o.status === 'delivered').length} delivered)`);

  // 6. Reviews (up to 200, respects uniqueness constraint)
  process.stdout.write('  Reviews… ');
  const customerIds = users.filter((u) => u.role === 'customer').map((u) => u._id);
  const reviewCount = await seedReviews(orders, customerIds);
  console.log(`✓ ${reviewCount} reviews`);

  // 7. Optional: real embeddings
  if (process.env['SEED_EMBEDDINGS'] === 'real') {
    console.log('\n  Generating real OpenAI embeddings for products…');
    const { ProductModel } = await import('@ecom/db');
    const { EmbedderFactory } = await import('@ecom/ai');
    const embedder = EmbedderFactory.create();
    const products = await ProductModel.find({ _id: { $in: productIds } })
      .select('_id name description tags')
      .lean()
      .exec();

    const BATCH = 20;
    for (let i = 0; i < products.length; i += BATCH) {
      const batch = products.slice(i, i + BATCH);
      const texts = batch.map((p) =>
        [p.name, p.description, (p.tags ?? []).join(' ')].filter(Boolean).join('\n'),
      );
      const embeddings = await embedder.embed(texts);
      await Promise.all(
        batch.map((p, j) =>
          ProductModel.findByIdAndUpdate(p._id, {
            $set: {
              embedding: embeddings[j],
              embeddingModel: 'text-embedding-3-large',
              embeddingUpdatedAt: new Date(),
            },
          }).exec(),
        ),
      );
      process.stdout.write(`    batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(products.length / BATCH)} ✓\n`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Seed complete in ${elapsed}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
