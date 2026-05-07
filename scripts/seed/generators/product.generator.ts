import { faker } from '@faker-js/faker';
import mongoose, { Types } from 'mongoose';
import { ProductModel } from '@ecom/db';
import type { SeededCategory } from './types.js';
import { mockEmbedding } from './embedding.js';
// re-export for convenience
export type { SeededCategory };

const PRODUCTS_PER_CATEGORY = 5;

const PRODUCT_TEMPLATES: Record<string, Array<{ name: string; tags: string[]; attrs: Record<string, string> }>> = {
  'electronics-phones': [
    { name: 'ProMax Smartphone 15', tags: ['smartphone', '5G', 'flagship', 'camera'], attrs: { storage: '256GB', ram: '12GB', display: '6.7 inch OLED', battery: '4500mAh' } },
    { name: 'NovaPro Wireless Earbuds', tags: ['earbuds', 'wireless', 'ANC', 'bluetooth'], attrs: { batteryLife: '8 hours', chargingCase: '32 hours', driver: '10mm', connectivity: 'Bluetooth 5.3' } },
    { name: 'UltraCharge 65W GaN Charger', tags: ['charger', 'GaN', 'fast-charge', 'USB-C'], attrs: { wattage: '65W', ports: '2x USB-C 1x USB-A', compatibility: 'Universal' } },
    { name: 'ClearView Tempered Glass Screen Protector', tags: ['screen-protector', 'tempered-glass', 'anti-scratch'], attrs: { thickness: '0.3mm', hardness: '9H', compatibility: 'Universal 6.7 inch' } },
    { name: 'SlimFit Magsafe Phone Case', tags: ['phone-case', 'magsafe', 'slim', 'protective'], attrs: { material: 'TPU + Polycarbonate', weight: '28g', magsafe: 'Yes' } },
  ],
  'electronics-laptops': [
    { name: 'AeroBook Pro 14', tags: ['laptop', 'ultrabook', 'M3', 'productivity'], attrs: { processor: 'M3 Pro', ram: '18GB', storage: '512GB SSD', display: '14.2 inch Retina', battery: '18 hours' } },
    { name: 'GameForce RTX 4070 Laptop', tags: ['gaming-laptop', 'RTX', 'high-performance', 'RGB'], attrs: { processor: 'Intel i9-14900HX', ram: '32GB DDR5', storage: '1TB NVMe', gpu: 'RTX 4070 8GB', display: '15.6 inch 165Hz' } },
    { name: 'ErgoStand Pro Laptop Stand', tags: ['laptop-stand', 'ergonomic', 'adjustable', 'aluminium'], attrs: { material: 'Aluminium alloy', compatibility: '10-17 inch', height: '6 levels', weight: '1.2kg' } },
    { name: 'MechPro TKL Keyboard', tags: ['mechanical-keyboard', 'TKL', 'RGB', 'wireless'], attrs: { switches: 'Brown', layout: 'TKL 87 key', connectivity: 'Wireless + USB-C', battery: '3000mAh' } },
    { name: 'PrecisionTrack Pro Mouse', tags: ['mouse', 'wireless', 'ergonomic', 'programmable'], attrs: { dpi: '200-12000', buttons: '7', battery: '70 days', connectivity: 'Bluetooth + 2.4GHz' } },
  ],
  'electronics-audio': [
    { name: 'SoundElite ANC Headphones', tags: ['headphones', 'over-ear', 'ANC', 'wireless', 'premium'], attrs: { driver: '40mm', batteryLife: '30 hours', ANC: 'Yes', foldable: 'Yes', connectivity: 'Bluetooth 5.2' } },
    { name: 'BassBoom Portable Speaker', tags: ['speaker', 'bluetooth', 'portable', 'waterproof'], attrs: { power: '30W', batteryLife: '24 hours', waterproof: 'IP67', connectivity: 'Bluetooth 5.3' } },
    { name: 'StudioMic USB Condenser', tags: ['microphone', 'USB', 'condenser', 'streaming', 'podcast'], attrs: { pattern: 'Cardioid', frequency: '20Hz-20kHz', sampleRate: '24-bit/96kHz', connectivity: 'USB-C' } },
    { name: 'ClearSound True Wireless Earbuds', tags: ['earbuds', 'TWS', 'noise-cancelling', 'sport'], attrs: { driver: '8mm', batteryLife: '7 hours', IPX: 'IPX5', connectivity: 'Bluetooth 5.3' } },
    { name: 'AudioPro DAC Amplifier', tags: ['DAC', 'amplifier', 'hi-fi', 'portable'], attrs: { output: '3.5mm + 4.4mm balanced', SNR: '120dB', compatibility: 'USB-C', power: '250mW @32Ω' } },
  ],
  'fashion-mens': [
    { name: 'PremiumCotton Oxford Shirt', tags: ['shirt', 'oxford', 'formal', 'cotton', 'mens'], attrs: { material: '100% Egyptian Cotton', fit: 'Regular', collarType: 'Button-down', careInstructions: 'Machine washable' } },
    { name: 'SlimFit Chino Pants', tags: ['pants', 'chino', 'slim-fit', 'stretch', 'mens'], attrs: { material: '97% Cotton 3% Elastane', fit: 'Slim', rise: 'Mid', closure: 'Zip fly' } },
    { name: 'TechFleece Zip Hoodie', tags: ['hoodie', 'fleece', 'athleisure', 'mens'], attrs: { material: '85% Polyester 15% Cotton', fit: 'Regular', pockets: '2 side + 1 chest', closure: 'Full zip' } },
    { name: 'CasualWeave Canvas Backpack', tags: ['backpack', 'canvas', 'casual', 'laptop'], attrs: { material: 'Canvas + Leather trim', capacity: '25L', laptopSlot: '15 inch', pockets: '5' } },
    { name: 'ClassicLeather Belt', tags: ['belt', 'leather', 'genuine', 'classic'], attrs: { material: 'Full-grain leather', width: '35mm', sizes: '28-46 inches', buckle: 'Silver tone' } },
  ],
  'fashion-womens': [
    { name: 'FlowDress Midi Wrap Dress', tags: ['dress', 'wrap', 'midi', 'floral', 'womens'], attrs: { material: 'Viscose', fit: 'Wrap', length: 'Midi', care: 'Hand wash' } },
    { name: 'EcoKnit Ribbed Turtleneck', tags: ['top', 'turtleneck', 'ribbed', 'sustainable', 'womens'], attrs: { material: '60% TENCEL 40% Organic Cotton', fit: 'Slim', origin: 'Sustainable' } },
    { name: 'HighWaist Wide-Leg Trousers', tags: ['trousers', 'wide-leg', 'high-waist', 'formal', 'womens'], attrs: { material: 'Crepe fabric', fit: 'Wide leg', waist: 'High', pockets: 'Yes' } },
    { name: 'SilkTouch Blouse', tags: ['blouse', 'silk', 'dressy', 'womens'], attrs: { material: '100% Mulberry Silk', fit: 'Relaxed', closure: 'Button front', care: 'Dry clean' } },
    { name: 'CozyKnit Cardigan', tags: ['cardigan', 'knit', 'cozy', 'layering', 'womens'], attrs: { material: 'Merino Wool Blend', fit: 'Oversized', length: 'Long', buttons: 'Horn' } },
  ],
  'fashion-footwear': [
    { name: 'CloudRun Performance Sneakers', tags: ['sneakers', 'running', 'cushioned', 'breathable'], attrs: { sole: 'CloudFoam', upper: 'Engineered mesh', drop: '8mm', weight: '265g' } },
    { name: 'HeritageCraft Leather Boots', tags: ['boots', 'leather', 'ankle', 'heritage'], attrs: { material: 'Full-grain leather', sole: 'Vibram rubber', height: 'Ankle', waterproof: 'Yes' } },
    { name: 'ComfortStep Loafers', tags: ['loafers', 'slip-on', 'comfort', 'casual'], attrs: { material: 'Suede', lining: 'Leather', sole: 'Rubber', cushioning: 'Memory foam insole' } },
    { name: 'UltraLight Trail Runners', tags: ['trail-runners', 'outdoor', 'grip', 'lightweight'], attrs: { weight: '285g', outsole: 'Vibram Megagrip', waterproof: 'Gore-Tex', drop: '6mm' } },
    { name: 'EveningGlam Heeled Sandals', tags: ['sandals', 'heels', 'evening', 'elegant'], attrs: { heelHeight: '7cm', material: 'Patent leather', closure: 'Buckle', sole: 'Leather' } },
  ],
  'home-kitchen': [
    { name: 'TriPly Stainless Steel Cookware Set', tags: ['cookware', 'stainless-steel', 'tri-ply', 'induction'], attrs: { pieces: '10', material: '3-ply stainless steel', compatibility: 'All cooktops', dishwasherSafe: 'Yes' } },
    { name: 'SmartBrew Coffee Machine', tags: ['coffee', 'espresso', 'smart', 'programmable'], attrs: { capacity: '1.8L', pressure: '15 bar', grinder: 'Built-in conical burr', connectivity: 'WiFi + Bluetooth' } },
    { name: 'AirPro 6Qt Air Fryer', tags: ['air-fryer', 'healthy-cooking', 'XL', 'digital'], attrs: { capacity: '6 quarts', power: '1700W', presets: '12', dishwasherSafe: 'Basket yes' } },
    { name: 'CutPro Chef Knife Set', tags: ['knife', 'chef-knife', 'German-steel', 'professional'], attrs: { steel: 'German X50CrMoV15', pieces: '7', handle: 'Ergonomic pakkawood', sharpness: 'Hand-honed 15°' } },
    { name: 'SpiceRack 24-Jar Organizer', tags: ['spice-rack', 'organizer', 'bamboo', 'kitchen'], attrs: { material: 'Bamboo', jars: '24', capacity: '4oz each', mounting: 'Countertop or wall' } },
  ],
  'home-furniture': [
    { name: 'ModernPly Floating Shelf Set', tags: ['shelf', 'floating', 'modern', 'wood', 'wall-mount'], attrs: { material: 'Solid pine', pieces: '3', sizes: '30cm / 45cm / 60cm', loadCapacity: '15kg each' } },
    { name: 'ErgoDesk Sit-Stand Desk', tags: ['desk', 'sit-stand', 'electric', 'height-adjustable', 'home-office'], attrs: { surface: '140x70cm', height: '72-120cm', motor: 'Dual motor', weight: '25kg' } },
    { name: 'LuxeSofa 3-Seater L-Shape', tags: ['sofa', 'L-shape', 'sectional', 'velvet', 'modern'], attrs: { material: 'Premium velvet fabric', seats: '5', dimensions: '280x200cm', legs: 'Solid wood' } },
    { name: 'ReadNook Bookshelf 5-Tier', tags: ['bookshelf', '5-tier', 'industrial', 'metal-wood'], attrs: { material: 'Metal frame + MDF', tiers: '5', dimensions: '80x30x180cm', capacity: '50kg' } },
    { name: 'ZenSleep Memory Foam Mattress', tags: ['mattress', 'memory-foam', 'medium-firm', 'cooling'], attrs: { thickness: '25cm', firmness: 'Medium-firm', cooling: 'CoolGel layer', warranty: '10 years' } },
  ],
  'sports-fitness': [
    { name: 'AdjustFlex Dumbbell Set 5-50lb', tags: ['dumbbells', 'adjustable', 'home-gym', 'strength'], attrs: { weightRange: '5-50lbs', increments: '2.5lb', material: 'Steel + rubber coating', replaces: '17 pairs' } },
    { name: 'YogaBalance Premium Mat', tags: ['yoga-mat', 'non-slip', 'eco-friendly', 'thick'], attrs: { thickness: '6mm', material: 'Natural rubber', dimensions: '183x61cm', texture: 'Alignment lines' } },
    { name: 'PowerBand Resistance Set', tags: ['resistance-bands', 'workout', 'portable', 'set'], attrs: { levels: '5 levels', resistance: '10-150lbs', material: 'Natural latex', accessories: 'Handles + ankle straps' } },
    { name: 'RunPro GPS Sports Watch', tags: ['smartwatch', 'GPS', 'running', 'multisport', 'heart-rate'], attrs: { battery: '14 days', gps: 'Multi-band', sensors: 'HR + SpO2 + Altimeter', waterproof: '100m' } },
    { name: 'CrossFit Jump Rope Speed Cable', tags: ['jump-rope', 'speed', 'crossfit', 'adjustable'], attrs: { material: 'Steel cable + aluminum handles', adjustable: 'Yes', bearing: 'Ball bearing', length: 'Up to 3.6m' } },
  ],
};

function generatePrice(min: number, max: number): string {
  return (Math.random() * (max - min) + min).toFixed(2);
}

function categoryPriceRange(slug: string): [number, number] {
  if (slug.includes('laptop') || slug.includes('furniture') || slug.includes('mattress')) return [199, 2499];
  if (slug.includes('phone') || slug.includes('headphone') || slug.includes('audio')) return [29, 499];
  if (slug.includes('fashion') || slug.includes('footwear')) return [24, 299];
  if (slug.includes('kitchen') || slug.includes('fitness')) return [19, 399];
  return [15, 299];
}

export async function seedProducts(categories: SeededCategory[]): Promise<Types.ObjectId[]> {
  const leafCategories = categories.filter((c) => c.level === 1);
  const productIds: Types.ObjectId[] = [];

  // Use a deterministic vendor ID for all products
  const vendorId = new Types.ObjectId('aabbccddeeff001122334455');

  for (const cat of leafCategories) {
    const templates = PRODUCT_TEMPLATES[cat.slug] ?? [];
    const [priceMin, priceMax] = categoryPriceRange(cat.slug);

    for (let i = 0; i < PRODUCTS_PER_CATEGORY; i++) {
      const template = templates[i] ?? {
        name: `${cat.name} Product ${i + 1}`,
        tags: [cat.slug],
        attrs: {},
      };

      const sku = `${cat.slug.toUpperCase().replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`;
      const slug = `${cat.slug}-${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
      const basePrice = generatePrice(priceMin, priceMax);

      const doc = await ProductModel.findOneAndUpdate(
        { sku },
        {
          $setOnInsert: {
            sku,
            slug,
            name: template.name,
            description: faker.commerce.productDescription(),
            categoryId: cat._id,
            vendorId,
            price: {
              base: mongoose.Types.Decimal128.fromString(basePrice),
              currency: 'USD',
            },
            inventory: {
              quantity: faker.number.int({ min: 10, max: 500 }),
              reservedQuantity: 0,
              warehouseId: 'WH-US-EAST-01',
              lowStockThreshold: 10,
            },
            images: [
              {
                url: `https://placehold.co/600x400?text=${encodeURIComponent(template.name)}`,
                alt: template.name,
                isPrimary: true,
              },
            ],
            tags: template.tags,
            attributes: new Map(Object.entries(template.attrs)),
            rating: { average: faker.number.float({ min: 3.5, max: 5, fractionDigits: 1 }), count: faker.number.int({ min: 0, max: 200 }) },
            embedding: mockEmbedding(),
            embeddingModel: 'mock-unit-vector',
            embeddingUpdatedAt: new Date(),
            status: 'active',
            isDeleted: false,
          },
        },
        { upsert: true, new: true },
      ).lean();

      productIds.push(doc!._id);
    }
  }

  return productIds;
}

