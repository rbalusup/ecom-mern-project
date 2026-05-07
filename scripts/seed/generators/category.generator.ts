import type { Types } from 'mongoose';
import { CategoryModel } from '@ecom/db';
import { mockEmbedding } from './embedding.js';

interface SeededCategory {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  level: number;
}

const CATEGORY_TREE = [
  {
    name: 'Electronics',
    slug: 'electronics',
    description: 'Consumer electronics, gadgets, and accessories',
    children: [
      { name: 'Phones & Accessories', slug: 'electronics-phones', description: 'Smartphones, cases, chargers' },
      { name: 'Laptops & Computers', slug: 'electronics-laptops', description: 'Laptops, desktops, peripherals' },
      { name: 'Audio & Headphones', slug: 'electronics-audio', description: 'Headphones, speakers, earbuds' },
    ],
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    description: 'Clothing, footwear, and accessories',
    children: [
      { name: "Men's Clothing", slug: 'fashion-mens', description: 'Shirts, pants, jackets for men' },
      { name: "Women's Clothing", slug: 'fashion-womens', description: 'Dresses, tops, pants for women' },
      { name: 'Footwear', slug: 'fashion-footwear', description: 'Shoes, boots, sandals for all' },
    ],
  },
  {
    name: 'Home & Garden',
    slug: 'home-garden',
    description: 'Home decor, furniture, and garden supplies',
    children: [
      { name: 'Kitchen & Dining', slug: 'home-kitchen', description: 'Cookware, appliances, and tableware' },
      { name: 'Furniture', slug: 'home-furniture', description: 'Sofas, beds, desks, and shelving' },
      { name: 'Fitness Equipment', slug: 'sports-fitness', description: 'Weights, yoga mats, cardio machines' },
    ],
  },
];

export async function seedCategories(): Promise<SeededCategory[]> {
  const seeded: SeededCategory[] = [];

  for (let i = 0; i < CATEGORY_TREE.length; i++) {
    const parent = CATEGORY_TREE[i]!;
    const parentDoc = await CategoryModel.findOneAndUpdate(
      { slug: parent.slug },
      {
        $setOnInsert: {
          name: parent.name,
          slug: parent.slug,
          description: parent.description,
          level: 0,
          path: parent.slug,
          embedding: mockEmbedding(),
          isActive: true,
          sortOrder: i,
        },
      },
      { upsert: true, new: true },
    ).lean();

    seeded.push({ _id: parentDoc!._id, slug: parentDoc!.slug, name: parentDoc!.name, level: 0 });

    for (let j = 0; j < parent.children.length; j++) {
      const child = parent.children[j]!;
      const childDoc = await CategoryModel.findOneAndUpdate(
        { slug: child.slug },
        {
          $setOnInsert: {
            name: child.name,
            slug: child.slug,
            description: child.description,
            parentId: parentDoc!._id,
            level: 1,
            path: `${parent.slug}/${child.slug}`,
            embedding: mockEmbedding(),
            isActive: true,
            sortOrder: j,
          },
        },
        { upsert: true, new: true },
      ).lean();

      seeded.push({ _id: childDoc!._id, slug: childDoc!.slug, name: childDoc!.name, level: 1 });
    }
  }

  return seeded;
}
