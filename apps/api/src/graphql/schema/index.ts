import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { gql } from 'graphql-tag';
import type { DocumentNode } from 'graphql';

const __dirname = dirname(fileURLToPath(import.meta.url));

const schemaFiles = [
  'directives.graphql',
  'pagination.graphql',
  'user.graphql',
  'category.graphql',
  'product.graphql',
  'order.graphql',
  'cart.graphql',
  'coupon.graphql',
  'review.graphql',
  'ai.graphql',
  'root.graphql',
];

function loadSchema(): DocumentNode {
  const sdl = schemaFiles
    .map((file) => readFileSync(resolve(__dirname, file), 'utf-8'))
    .join('\n');
  return gql(sdl);
}

export const typeDefs = loadSchema();
