import { faker } from '@faker-js/faker';
import type { Types } from 'mongoose';
import { ReviewModel } from '@ecom/db';
import type { SeededOrder } from './order.generator.js';

const TOTAL_REVIEWS = 200;

const REVIEW_TEMPLATES = [
  { rating: 5, titles: ['Absolutely love it!', 'Best purchase this year', 'Exceeded expectations', 'Perfect product!', 'Highly recommend'] },
  { rating: 4, titles: ['Great product', 'Very happy with this', 'Good quality', 'Works as described', 'Would buy again'] },
  { rating: 3, titles: ['Decent quality', 'Average product', 'Does the job', 'Some pros and cons', 'OK for the price'] },
  { rating: 2, titles: ['Disappointed', 'Not what I expected', 'Some issues', 'Mixed experience', 'Could be better'] },
  { rating: 1, titles: ['Very disappointed', 'Do not recommend', 'Poor quality', 'Not worth it', 'Returned it'] },
];

function randomRating(): 1 | 2 | 3 | 4 | 5 {
  const rand = Math.random();
  if (rand < 0.45) return 5;
  if (rand < 0.70) return 4;
  if (rand < 0.85) return 3;
  if (rand < 0.95) return 2;
  return 1;
}

export async function seedReviews(
  orders: SeededOrder[],
  customerIds: Types.ObjectId[],
): Promise<number> {
  // Only delivered orders qualify for verified purchases
  const deliveredOrders = orders.filter((o) => o.status === 'delivered');

  let created = 0;

  for (let i = 0; i < TOTAL_REVIEWS; i++) {
    const rating = randomRating();
    const template = REVIEW_TEMPLATES.find((t) => t.rating === rating)!;
    const title = faker.helpers.arrayElement(template.titles);

    let productId: Types.ObjectId;
    let customerId: Types.ObjectId;
    let orderId: Types.ObjectId | undefined;
    let verifiedPurchase = false;

    // 70% of reviews are from verified delivered orders
    if (deliveredOrders.length > 0 && Math.random() < 0.7) {
      const order = faker.helpers.arrayElement(deliveredOrders)!;
      productId = faker.helpers.arrayElement(order.productIds)!;
      customerId = order.customerId;
      orderId = order._id;
      verifiedPurchase = true;
    } else {
      // Unverified review — any customer on any product
      const allProductIds = [...new Set(orders.flatMap((o) => o.productIds.map((id) => id.toString())))];
      productId = faker.helpers.arrayElement(orders.flatMap((o) => o.productIds))!;
      customerId = faker.helpers.arrayElement(customerIds)!;
    }

    // Check uniqueness constraint: productId + customerId must be unique
    const exists = await ReviewModel.findOne({ productId, customerId }).lean().exec();
    if (exists) continue;

    await ReviewModel.create({
      productId,
      customerId,
      orderId,
      rating,
      title,
      body: faker.lorem.sentences(faker.number.int({ min: 2, max: 5 })),
      verifiedPurchase,
      helpful: faker.number.int({ min: 0, max: 50 }),
      aiSummaryContribution: true,
      isDeleted: false,
      createdAt: faker.date.recent({ days: 180 }),
    });

    created++;
  }

  return created;
}
