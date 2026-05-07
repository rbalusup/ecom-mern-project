import { faker } from '@faker-js/faker';
import mongoose, { type Types } from 'mongoose';
import { OrderModel, ProductModel } from '@ecom/db';

const TOTAL_ORDERS = 200;
const ORDER_STATUSES = [
  'pending_payment',
  'payment_processing',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number];

function weightedStatus(): OrderStatus {
  // Most orders delivered; distribution reflects a 6-month window
  const rand = Math.random();
  if (rand < 0.45) return 'delivered';
  if (rand < 0.60) return 'shipped';
  if (rand < 0.70) return 'processing';
  if (rand < 0.80) return 'confirmed';
  if (rand < 0.90) return 'payment_processing';
  return 'pending_payment';
}

function randomAddress() {
  return {
    line1: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    postalCode: faker.location.zipCode(),
    country: 'US',
  };
}

export interface SeededOrder {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  status: OrderStatus;
  productIds: Types.ObjectId[];
}

export async function seedOrders(
  userIds: Types.ObjectId[],
  productIds: Types.ObjectId[],
): Promise<SeededOrder[]> {
  // Pre-fetch product price/sku/name so we can build order items without N+1
  const products = await ProductModel.find({ _id: { $in: productIds } })
    .select('_id sku name price images')
    .lean()
    .exec();

  const seeded: SeededOrder[] = [];
  const customerIds = userIds; // all users can be customers

  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const orderNumber = `ORD-SEED-${String(i + 1).padStart(5, '0')}`;

    // Check idempotency
    const existing = await OrderModel.findOne({ orderNumber }).lean().exec();
    if (existing) {
      seeded.push({
        _id: existing._id,
        orderNumber: existing.orderNumber,
        customerId: existing.customerId,
        status: existing.status as OrderStatus,
        productIds: existing.items.map((it) => it.productId),
      });
      continue;
    }

    const customerId = faker.helpers.arrayElement(customerIds)!;
    const status = weightedStatus();
    const createdAt = faker.date.recent({ days: 180 });

    // 1-4 items per order
    const itemCount = faker.number.int({ min: 1, max: 4 });
    const chosenProducts = faker.helpers.arrayElements(products, itemCount);

    let subtotal = 0;
    const items = chosenProducts.map((p) => {
      const unitPrice = parseFloat(p.price.base.toString());
      const quantity = faker.number.int({ min: 1, max: 3 });
      const totalPrice = unitPrice * quantity;
      subtotal += totalPrice;
      return {
        productId: p._id,
        sku: p.sku,
        name: p.name,
        quantity,
        unitPrice: mongoose.Types.Decimal128.fromString(unitPrice.toFixed(2)),
        totalPrice: mongoose.Types.Decimal128.fromString(totalPrice.toFixed(2)),
        imageUrl: p.images[0]?.url,
      };
    });

    const tax = subtotal * 0.08;
    const shipping = subtotal > 100 ? 0 : 9.99;
    const total = subtotal + tax + shipping;

    await OrderModel.create({
      orderNumber,
      customerId,
      status,
      items,
      pricing: {
        subtotal: mongoose.Types.Decimal128.fromString(subtotal.toFixed(2)),
        tax: mongoose.Types.Decimal128.fromString(tax.toFixed(2)),
        shipping: mongoose.Types.Decimal128.fromString(shipping.toFixed(2)),
        discount: mongoose.Types.Decimal128.fromString('0.00'),
        total: mongoose.Types.Decimal128.fromString(total.toFixed(2)),
        currency: 'USD',
      },
      shippingAddress: randomAddress(),
      paymentMethod: {
        type: faker.helpers.arrayElement(['credit_card', 'debit_card', 'paypal']),
        last4: faker.finance.creditCardNumber('####'),
        provider: faker.helpers.arrayElement(['stripe', 'paypal', 'braintree']),
      },
      ...(status === 'shipped' || status === 'delivered'
        ? { trackingNumber: `1Z${faker.string.alphanumeric(16).toUpperCase()}` }
        : {}),
      metadata: new Map(),
      createdAt,
      updatedAt: createdAt,
    });

    const order = await OrderModel.findOne({ orderNumber }).lean().exec();
    seeded.push({
      _id: order!._id,
      orderNumber,
      customerId,
      status,
      productIds: items.map((it) => it.productId),
    });
  }

  return seeded;
}
