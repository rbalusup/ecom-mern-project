import { faker } from '@faker-js/faker';
import type { Types } from 'mongoose';
import { CouponModel } from '@ecom/db';

const COUPONS = [
  { code: 'WELCOME10', type: 'percent' as const, value: 10, minOrderValue: 50 },
  { code: 'SAVE20', type: 'percent' as const, value: 20, minOrderValue: 100, maxDiscountAmount: 50 },
  { code: 'FREESHIP', type: 'free_shipping' as const, value: 0, minOrderValue: 30 },
  { code: 'FLASH15', type: 'percent' as const, value: 15, maxDiscountAmount: 30 },
  { code: 'VIP25', type: 'percent' as const, value: 25, minOrderValue: 200, maxDiscountAmount: 100 },
  { code: 'SAVE5USD', type: 'fixed' as const, value: 5, minOrderValue: 25 },
  { code: 'SAVE10USD', type: 'fixed' as const, value: 10, minOrderValue: 50 },
  { code: 'SAVE25USD', type: 'fixed' as const, value: 25, minOrderValue: 100 },
  { code: 'SAVE50USD', type: 'fixed' as const, value: 50, minOrderValue: 200 },
  { code: 'TECHSALE', type: 'percent' as const, value: 12, minOrderValue: 150 },
  { code: 'FASHION20', type: 'percent' as const, value: 20, minOrderValue: 80 },
  { code: 'HOMESTYLE', type: 'percent' as const, value: 18, minOrderValue: 120 },
  { code: 'SPORTS15', type: 'percent' as const, value: 15, minOrderValue: 60 },
  { code: 'NEWUSER', type: 'fixed' as const, value: 15, minOrderValue: 40 },
  { code: 'LOYALTY30', type: 'percent' as const, value: 30, minOrderValue: 300, maxDiscountAmount: 150 },
  { code: 'SUMMER10', type: 'percent' as const, value: 10 },
  { code: 'WINTER15', type: 'percent' as const, value: 15, minOrderValue: 75 },
  { code: 'BOGO50', type: 'percent' as const, value: 50, minOrderValue: 100 },
  { code: 'CLEARANCE40', type: 'percent' as const, value: 40, maxDiscountAmount: 80 },
  { code: 'FREESHIP2', type: 'free_shipping' as const, value: 0, minOrderValue: 0 },
];

export async function seedCoupons(): Promise<Types.ObjectId[]> {
  const ids: Types.ObjectId[] = [];
  const now = new Date();

  for (const c of COUPONS) {
    const validFrom = faker.date.recent({ days: 30, refDate: now });
    const validUntil = faker.date.future({ years: 1, refDate: now });

    const doc = await CouponModel.findOneAndUpdate(
      { code: c.code },
      {
        $setOnInsert: {
          code: c.code,
          type: c.type,
          value: c.value,
          ...(c.minOrderValue !== undefined && { minOrderValue: c.minOrderValue }),
          ...(c.maxDiscountAmount !== undefined && { maxDiscountAmount: c.maxDiscountAmount }),
          usageLimit: faker.number.int({ min: 50, max: 1000 }),
          usedCount: faker.number.int({ min: 0, max: 20 }),
          perUserLimit: 1,
          applicableCategories: [],
          applicableProducts: [],
          validFrom,
          validUntil,
          isActive: true,
        },
      },
      { upsert: true, new: true },
    ).lean();

    ids.push(doc!._id);
  }

  return ids;
}
