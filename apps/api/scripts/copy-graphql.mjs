// Copies .graphql schema files from src/ to dist/ after tsc build.
import { cpSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'src/graphql/schema');
const dest = resolve(root, 'dist/graphql/schema');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true, filter: (s) => s.endsWith('.graphql') || !s.includes('.') });

console.log('✓ Copied .graphql schema files to dist/');
