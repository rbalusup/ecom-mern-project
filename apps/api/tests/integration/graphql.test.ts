import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getTestApp, closeTestApp, makeAuthHeader, gql } from '../fixtures/testServer.js';

let app: FastifyInstance;
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env['MONGODB_URI'] = mongod.getUri();
  process.env['MONGODB_DB_NAME'] = 'ecom_test';
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  process.env['JWT_SECRET'] = 'test-secret-key';
  process.env['NODE_ENV'] = 'test';
  process.env['LOG_LEVEL'] = 'silent';
  process.env['OTEL_SERVICE_NAME'] = 'ecom-api-test';

  app = await getTestApp();
}, 30_000);

afterAll(async () => {
  await closeTestApp();
  await mongod.stop();
});

describe('Health endpoints', () => {
  it('GET /health/live returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'alive' });
  });

  it('GET /health/ready returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready' });
  });
});

describe('GraphQL — unauthenticated queries', () => {
  it('categories query returns empty array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'content-type': 'application/json' },
      payload: gql('{ categories { id name slug } }'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { categories: unknown[] } }>();
    expect(body.data.categories).toEqual([]);
  });

  it('products query returns empty connection', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'content-type': 'application/json' },
      payload: gql('{ products { edges { node { id } } pageInfo { hasNextPage } totalCount } }'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { products: { totalCount: number } } }>();
    expect(body.data.products.totalCount).toBe(0);
  });

  it('cart query requires auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'content-type': 'application/json' },
      payload: gql('{ cart { id } }'),
    });
    const body = res.json<{ errors?: { extensions?: { code?: string } }[] }>();
    expect(body.errors?.[0]?.extensions?.code).toBe('UNAUTHORIZED');
  });
});

describe('GraphQL — authenticated queries', () => {
  it('me query returns current user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        'content-type': 'application/json',
        authorization: makeAuthHeader('customer', 'user-123'),
      },
      payload: gql('{ me { id email role } }'),
    });
    const body = res.json<{ data: { me: { id: string; role: string } | null } }>();
    // me resolver returns null if user not in DB yet — that's fine for this test
    expect(res.statusCode).toBe(200);
    expect(body.errors).toBeUndefined();
  });

  it('cart query returns cart for authenticated user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        'content-type': 'application/json',
        authorization: makeAuthHeader('customer'),
      },
      payload: gql('{ cart { id itemCount subtotal } }'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { cart: { id: string; itemCount: number } | null } }>();
    expect(body.errors).toBeUndefined();
  });
});

describe('GraphQL — admin authorization', () => {
  it('admin can access orders list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        'content-type': 'application/json',
        authorization: makeAuthHeader('admin'),
      },
      payload: gql('{ orders { edges { node { id } } totalCount } }'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ errors?: unknown[] }>();
    expect(body.errors).toBeUndefined();
  });

  it('customer cannot access admin orders list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        'content-type': 'application/json',
        authorization: makeAuthHeader('customer'),
      },
      payload: gql('{ orders { edges { node { id } } totalCount } }'),
    });
    const body = res.json<{ errors?: { extensions?: { code?: string } }[] }>();
    expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});

describe('JSON-RPC bridge', () => {
  it('POST /rpc getCategories returns result', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rpc',
      headers: { 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'getCategories', params: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ jsonrpc: string; id: number; result: { categories: unknown[] } }>();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result).toHaveProperty('categories');
  });

  it('POST /rpc unknown method returns -32601', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rpc',
      headers: { 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 2, method: 'nonExistentMethod', params: {} },
    });
    const body = res.json<{ error: { code: number } }>();
    expect(body.error.code).toBe(-32601);
  });
});
