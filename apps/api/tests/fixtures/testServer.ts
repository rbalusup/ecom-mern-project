import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { signJWT } from '../../src/middleware/auth.middleware.js';

let _app: FastifyInstance | null = null;

export async function getTestApp(): Promise<FastifyInstance> {
  if (_app) return _app;
  _app = await buildApp();
  await _app.ready();
  return _app;
}

export async function closeTestApp(): Promise<void> {
  if (_app) {
    await _app.close();
    _app = null;
  }
}

export function makeAuthHeader(role: 'customer' | 'vendor' | 'admin' = 'customer', id = 'test-user-id'): string {
  const token = signJWT({ id, email: `${role}@test.com`, role });
  return `Bearer ${token}`;
}

export function gql(query: string, variables?: Record<string, unknown>) {
  return JSON.stringify({ query, variables });
}
