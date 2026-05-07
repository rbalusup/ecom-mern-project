# ADR 001 — Fastify 4 over Express 5

**Status**: Accepted  
**Date**: 2026-05-07

## Context

The GraphQL API must run as an AWS Lambda function with minimal cold-start time and maximum throughput. Apollo Server 4 needs an HTTP framework adapter.

## Decision

Use **Fastify 4** with `@as-integration/fastify` (Apollo Server 4's official Fastify plugin).

## Rationale

| Factor | Fastify | Express |
|---|---|---|
| Throughput | ~90K req/s | ~45K req/s |
| Cold start | Faster (smaller footprint) | Slower |
| Schema validation | Built-in (Ajv, zero middleware) | Requires body-parser + validation middleware |
| TypeScript | First-class generics | Requires type augmentation |
| Plugin system | Encapsulated (no conflicts) | Flat middleware chain |
| Apollo Server 4 | Official `@as-integration/fastify` | Official `expressMiddleware` |
| Lambda adapter | `@fastify/aws-lambda` | `aws-serverless-express` (unmaintained) |

## Consequences

- All Fastify plugins use `fastify-plugin` to break encapsulation where needed.
- Route handlers use Fastify's typed `request.body` instead of Express's `req.body as T`.
- Error handling uses Fastify's `setErrorHandler` hook instead of Express error middleware.
