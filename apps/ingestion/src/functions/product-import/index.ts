/**
 * S3-triggered Lambda: imports products from CSV files uploaded to the
 * product-assets S3 bucket under prefix `imports/`.
 *
 * CSV format: sku,name,description,categoryId,vendorId,basePrice,tags,status
 *
 * Flow:
 *  1. Download CSV from S3
 *  2. Parse rows with csv-parse
 *  3. Validate each row with Zod
 *  4. Upsert products in MongoDB (no hard deletes)
 *  5. Publish product.created/updated events to EventBridge per batch
 *  6. Write summary to S3 result file
 */

import type { S3Event, S3Handler } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

import { connectDB, ProductModel } from '@ecom/db';
import { createLogger } from '@ecom/observability';
import { initTracer } from '@ecom/observability';

initTracer({ serviceName: 'ecom-product-import' });

const s3 = new S3Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

const logger = createLogger({
  service: 'ecom-product-import',
  env: process.env['NODE_ENV'] ?? 'production',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

const ProductRowSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().min(1),
  vendorId: z.string().min(1),
  basePrice: z.coerce.number().positive(),
  tags: z.string().optional(), // comma-separated
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
});

type ProductRow = z.infer<typeof ProductRowSchema>;

export const handler: S3Handler = async (event: S3Event) => {
  const mongoUri = process.env['MONGODB_URI'];
  if (!mongoUri) throw new Error('MONGODB_URI not set');
  await connectDB({ uri: mongoUri });

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    logger.info({ bucket, key }, 'Processing product import CSV');

    // 1. Download CSV
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await obj.Body?.transformToString('utf-8');
    if (!body) {
      logger.warn({ key }, 'Empty S3 object — skipping');
      continue;
    }

    // 2. Parse
    const rows: Record<string, string>[] = parse(body, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ row: number; error: string }> = [];

    // 3. Validate + upsert
    for (let i = 0; i < rows.length; i++) {
      const parsed = ProductRowSchema.safeParse(rows[i]);
      if (!parsed.success) {
        errors.push({ row: i + 2, error: parsed.error.message });
        errorCount++;
        continue;
      }

      const row: ProductRow = parsed.data;
      const slug = row.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      await ProductModel.findOneAndUpdate(
        { sku: row.sku },
        {
          $set: {
            name: row.name,
            description: row.description ?? '',
            slug,
            categoryId: row.categoryId,
            vendorId: row.vendorId,
            'price.base': row.basePrice,
            tags: row.tags ? row.tags.split(',').map((t) => t.trim()) : [],
            status: row.status,
          },
          $setOnInsert: {
            sku: row.sku,
            'inventory.quantity': 0,
            'inventory.reservedQuantity': 0,
            'inventory.lowStockThreshold': 10,
          },
        },
        { upsert: true, new: true },
      ).exec();

      successCount++;
    }

    logger.info({ key, successCount, errorCount }, 'Product import complete');

    // 4. Write result file next to the import
    const resultKey = key.replace(/\.csv$/, '-result.json');
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: resultKey,
      Body: JSON.stringify({ successCount, errorCount, errors }, null, 2),
      ContentType: 'application/json',
    }));
  }
};
