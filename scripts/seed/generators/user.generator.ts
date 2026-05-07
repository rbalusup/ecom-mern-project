import { faker } from '@faker-js/faker';
import type { Types } from 'mongoose';
import { UserModel } from '@ecom/db';
import { mockEmbedding } from './embedding.js';

const TOTAL_USERS = 100;
const ADMIN_COUNT = 10;
const VENDOR_COUNT = 5;

function randomAddress() {
  return {
    line1: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    postalCode: faker.location.zipCode(),
    country: 'US',
    isDefault: true,
  };
}

export interface SeededUser {
  _id: Types.ObjectId;
  email: string;
  role: 'customer' | 'admin' | 'vendor';
}

export async function seedUsers(): Promise<SeededUser[]> {
  const seeded: SeededUser[] = [];

  const roleFor = (i: number): 'admin' | 'vendor' | 'customer' =>
    i < ADMIN_COUNT ? 'admin' : i < ADMIN_COUNT + VENDOR_COUNT ? 'vendor' : 'customer';

  for (let i = 0; i < TOTAL_USERS; i++) {
    const role = roleFor(i);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    // Deterministic email so seeds are idempotent
    const email = `seed.${role}.${String(i).padStart(3, '0')}@ecom-genai.test`;
    const cognitoId = `seed-cognito-${role}-${String(i).padStart(3, '0')}`;

    const doc = await UserModel.findOneAndUpdate(
      { cognitoId },
      {
        $setOnInsert: {
          email,
          cognitoId,
          role,
          profile: {
            firstName,
            lastName,
            phone: faker.phone.number({ style: 'national' }),
            addresses: [randomAddress()],
            preferences: faker.helpers.arrayElements(
              ['electronics', 'fashion', 'sports', 'home', 'audio', 'gaming'],
              faker.number.int({ min: 1, max: 3 }),
            ),
          },
          profileEmbedding: mockEmbedding(),
          embeddingUpdatedAt: new Date(),
          isActive: true,
          lastLoginAt: faker.date.recent({ days: 30 }),
        },
      },
      { upsert: true, new: true },
    ).lean();

    seeded.push({ _id: doc!._id, email: doc!.email, role: doc!.role });
  }

  return seeded;
}
