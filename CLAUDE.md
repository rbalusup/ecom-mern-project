# CLAUDE.md — E-Commerce GenAI Lens Backend

## Project Overview

This is a production-grade e-commerce backend platform with AI/GenAI capabilities. It uses a **Turborepo monorepo** with `pnpm` workspaces.

## Repository Structure

```
apps/api/          GraphQL API server (Apollo Server 4 + Fastify 4)
apps/worker/       SQS/Kafka event processor (Lambda handlers)
apps/ingestion/    Data ingestion Lambda functions (S3, scheduled)
packages/shared/   Shared types, DTOs, errors, utilities
packages/db/       Mongoose models, repositories, aggregation pipelines
packages/ai/       Embeddings, vector search, LLM chains (RAG)
packages/observability/  Pino logger, OpenTelemetry, CloudWatch metrics
infra/terraform/   Infrastructure as Code (AWS + MongoDB Atlas)
scripts/           Seed data, migrations, Atlas index creation, backfill
docs/              Architecture docs, ADRs, progress tracking
```

## Key Commands

```bash
make dev          # Start API + all docker services
make services     # Start docker-compose only (MongoDB, Redis, Kafka, LocalStack)
make build        # Build all packages via Turborepo
make test         # Run all tests
make test-unit    # Unit tests only
make test-int     # Integration tests (testcontainers)
make seed         # Seed database with mock data (fast, no API calls)
make seed-real    # Seed with real OpenAI embeddings (~$0.02)
make backfill     # Backfill product embeddings (cursor-based, resumable)
make lint         # ESLint + Prettier check
make atlas-index  # Create Atlas Search text indexes
make atlas-vector # Create Atlas Vector Search index
```

## Environment Setup

```bash
cp .env.example .env
# Edit .env with your MongoDB URI, OpenAI key, AWS credentials
pnpm install
make services
make seed
pnpm dev
```

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript 5.x strict |
| HTTP/GraphQL | Fastify 4 + Apollo Server 4 (Federation v2) |
| Database | MongoDB Atlas, Mongoose 8 |
| Vector Search | MongoDB Atlas Vector Search (1536-dim, cosine) |
| Text Search | MongoDB Atlas Search |
| Cache | Redis (ElastiCache) via ioredis |
| Events | EventBridge + SQS/SNS + Kafka (MSK) via kafkajs |
| Serverless | AWS Lambda + API Gateway v2 |
| AI | OpenAI text-embedding-3-large, GPT-4o + AWS Bedrock |
| Logging | Pino (structured JSON) |
| Tracing | OpenTelemetry → AWS X-Ray |
| Metrics | OTel Metrics → CloudWatch EMF |
| IaC | Terraform 1.7+ |
| Testing | Vitest + supertest + testcontainers |
| Auth | AWS Cognito (JWT) |

## Coding Standards

- **TypeScript**: Strict mode throughout. No `any`. Use `exactOptionalPropertyTypes`.
- **Imports**: Type imports use `import type`. Sort via `import/order` ESLint rule.
- **Errors**: Throw typed errors from `@ecom/shared` (NotFoundError, ValidationError, etc.)
- **Async**: All async functions must be awaited. No floating promises.
- **Comments**: Only when the WHY is non-obvious. No JSDoc blocks.
- **Logging**: Always use the Pino logger, never `console.log`.
- **Secrets**: Never hardcode secrets. Always read from environment or AWS Secrets Manager.

## GraphQL Conventions

- All list queries use Relay Connection spec (cursor pagination).
- Resolvers must never do N+1 — use DataLoaders for all relations.
- Use `@auth(roles: [...])` directive for authorization, never inline checks.
- Rate-limit expensive AI operations with `@rateLimit`.
- Query complexity limit: 50. Depth limit: 7.

## Event Architecture

- All domain events go through EventBridge bus `ecom-genai-{env}`.
- SQS handlers must check idempotency via Redis SETNX before processing.
- All SQS messages include OTel trace context in message attributes.
- DLQ alerts fire to SNS ops-alert topic when depth > 0.

## MongoDB Conventions

- All repos extend `BaseRepository<T>` from `packages/db`.
- Cursor pagination uses base64url-encoded `_id` or sort field values.
- Soft delete via `isDeleted: boolean` — never hard delete production data.
- All financial values stored as `Decimal128` in MongoDB.
- Product `embedding` field is excluded from default queries (`select: false`).

## AI/GenAI Conventions

- Always use `EmbedderFactory` — never import embedder implementations directly.
- Check embedding cache (Redis `emb:{sha256(text)}`, TTL 7d) before calling API.
- All AI queries must produce an `AIQuery` document for audit trail.
- Include `traceId` in all AI query results.
- Minimum vector similarity threshold for RAG context: 0.7.

## Testing

- Unit tests: `*.test.ts` alongside source files, or in `tests/unit/`.
- Integration tests: `tests/integration/` — use testcontainers for real MongoDB/Redis.
- Minimum coverage: 80%.
- Never mock the database in integration tests.

## Build Phases

See [docs/PROGRESS.md](docs/PROGRESS.md) for current build status.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design.
See [docs/ADR/](docs/ADR/) for architectural decisions.
