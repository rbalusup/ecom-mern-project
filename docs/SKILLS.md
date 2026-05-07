# Skills & Competencies Map

This document maps the platform's technical skill areas to their implementation locations and current status.

## 1. MongoDB — Advanced Data Layer

| Skill | Implementation | Location |
|---|---|---|
| Data modeling with TypeScript generics | Mongoose schemas with typed Documents | `packages/db/src/models/` |
| Compound indexes + multikey indexes | Defined on each schema | `packages/db/src/models/*.model.ts` |
| Aggregation pipelines | Reusable pipeline builders | `packages/db/src/aggregations/` |
| Atlas Full-Text Search | JSON index definitions + `$search` stage | `packages/db/src/indexes/atlas-search/product-text.json` |
| Atlas Vector Search | JSON index definitions + `$vectorSearch` stage | `packages/db/src/indexes/atlas-search/product-vector.json` |
| Cursor-based pagination | Generic base repository | `packages/db/src/repositories/base.repository.ts` |
| Soft delete pattern | `isDeleted` flag on Product, Review | All models |
| Event sourcing | `OrderEvent` collection + transaction | `packages/db/src/models/Order.model.ts` |
| Sharding | `categoryId` shard key (Product), `customerId` (Order) | Schema comments |
| TTL indexes | AIQuery (90 days), Cart (30 days) | `AIQuery.model.ts`, `Cart.model.ts` |

## 2. GraphQL with JSON-RPC

| Skill | Implementation | Location |
|---|---|---|
| Schema-first design (.graphql files) | Per-domain type definitions | `apps/api/src/graphql/schema/` |
| Custom directives (@auth, @rateLimit) | Transformer-based implementations | `apps/api/src/graphql/directives/` |
| DataLoader batching | Per-entity DataLoaders | `apps/api/src/graphql/dataloaders/` |
| Relay Connection pagination | All collection queries | Schema + `packages/shared/src/utils/pagination.ts` |
| Query complexity + depth limiting | Apollo plugins | `apps/api/src/graphql/plugins/` |
| Federation v2 ready | `@key` directives on entities | Schema definitions |
| JSON-RPC 2.0 bridge | Named operation mapping | `apps/api/src/routes/jsonrpc.route.ts` |
| Subscription (WebSocket) | Order status + inventory updates | `apps/api/src/graphql/resolvers/subscription.resolver.ts` |

## 3. Node.js with TypeScript

| Skill | Implementation | Location |
|---|---|---|
| TypeScript 5.x strict mode | `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` | `tsconfig.base.json` |
| Turborepo monorepo | Remote caching, incremental builds | `turbo.json` |
| pnpm workspaces | Workspace protocol dependencies | `pnpm-workspace.yaml` |
| Fastify 4 framework | Plugin architecture, Ajv validation | `apps/api/src/` |
| Zod validation | All DTOs and env schemas | `packages/shared/src/utils/validation.ts` |
| Error hierarchy | Typed application errors | `packages/shared/src/errors/` |

## 4. CI/CD (GitHub Actions)

| Skill | Implementation | Location |
|---|---|---|
| Lint + typecheck pipeline | ESLint, tsc --noEmit | `.github/workflows/ci.yml` |
| Unit test + coverage | Vitest, Codecov | `.github/workflows/ci.yml` |
| Integration tests | testcontainers + LocalStack | `.github/workflows/integration-tests.yml` |
| Terraform plan on PR | tfcmt PR comment | `.github/workflows/terraform-plan.yml` |
| Terraform apply on merge | dev → staging → prod gates | `.github/workflows/terraform-apply.yml` |
| Lambda blue/green deploy | Alias swap + rollback | `.github/workflows/deploy-api.yml` |

## 5. Serverless / Event-Driven Architecture

| Skill | Implementation | Location |
|---|---|---|
| Lambda handler pattern | Fastify adapter + SQS batch | `apps/api/src/lambda.ts`, `apps/worker/src/lambda.ts` |
| SQS consumer with batching | `batchItemFailures` pattern | `apps/worker/src/handlers/` |
| EventBridge event catalog | Typed event schemas | `packages/shared/src/types/events.types.ts` |
| SNS fan-out | Notification + ops-alert topics | `infra/terraform/modules/messaging/` |
| S3-triggered Lambda | CSV product import | `apps/ingestion/src/functions/product-import/` |
| EventBridge scheduled jobs | Order snapshot, embedding backfill | `apps/ingestion/src/functions/` |
| Kafka producer/consumer | KafkaJS with MSK | `apps/worker/src/kafka/` |
| API Gateway v2 HTTP | Lambda integration + CORS | `infra/terraform/modules/api/` |

## 6. Terraform Infrastructure

| Skill | Implementation | Location |
|---|---|---|
| Modular Terraform | 9 reusable modules | `infra/terraform/modules/` |
| Multi-environment | dev / staging / prod tfvars | `infra/terraform/environments/` |
| S3 remote state | Per-environment backend | `environments/*/backend.tf` |
| VPC + networking | 3-AZ, public/private, NAT | `modules/networking/` |
| IAM least-privilege | Lambda execution roles | `modules/iam/` |
| AWS Secrets Manager | MongoDB URI, API keys | `modules/database/` |
| Atlas Terraform provider | `mongodb/mongodbatlas` | `modules/database/` |
| ElastiCache Redis | Multi-AZ in prod | `modules/cache/` |
| MSK (Kafka) | SASL/SCRAM auth | `modules/messaging/msk.tf` |

## 7. Observability

| Skill | Implementation | Location |
|---|---|---|
| Structured logging (Pino) | JSON envelope with traceId | `packages/observability/src/logger.ts` |
| OpenTelemetry instrumentation | HTTP + Mongoose auto-instrumentation | `packages/observability/src/tracer.ts` |
| Trace context propagation | HTTP header → SQS attributes → Kafka headers | `packages/observability/src/correlation.ts` |
| X-Ray export | OTLP → CloudWatch X-Ray endpoint | `packages/observability/src/tracer.ts` |
| Custom metrics (OTel) | AI latency, resolver duration, order throughput | `packages/observability/src/metrics.ts` |
| CloudWatch EMF | Embedded metric format for Lambda | `packages/observability/src/metrics.ts` |
| CloudWatch dashboards | 4-row KPI dashboard | `infra/terraform/modules/observability/` |
| Alerting | Lambda error, DLQ depth, AI p99 | `infra/terraform/modules/observability/` |

## 8. Data Ingestion Pipelines

| Skill | Implementation | Location |
|---|---|---|
| S3-triggered batch import | CSV product import with validation | `apps/ingestion/src/functions/product-import/` |
| Idempotency (Redis SETNX) | Before every SQS handler | `apps/worker/src/processors/idempotency.ts` |
| Cursor-based backfill | Redis checkpoint, resume on failure | `scripts/backfill/backfill-embeddings.ts` |
| DLQ handling + alerting | Poison message logging + SNS | `apps/worker/src/handlers/dlq.handler.ts` |
| Retry with exponential backoff | p-retry in embedding generator | `apps/worker/src/processors/embedding.processor.ts` |
| Fault-tolerant batch | `batchItemFailures` SQS response | All SQS handlers |

## 9. Scalable GraphQL Patterns

| Skill | Implementation | Location |
|---|---|---|
| DataLoader batching (N+1 prevention) | Per-entity loaders with per-request registry | `apps/api/src/graphql/dataloaders/` |
| Redis response caching | TTL-based per resolver | `apps/api/src/plugins/redis.plugin.ts` |
| Cursor pagination | Relay Connection spec, stable under inserts | `packages/db/src/repositories/base.repository.ts` |
| Query complexity analysis | Apollo complexity plugin | `apps/api/src/graphql/plugins/complexity.plugin.ts` |
| Depth limiting | Apollo depth limit plugin | `apps/api/src/graphql/plugins/depthLimit.plugin.ts` |
| @rateLimit directive | Redis sliding window | `apps/api/src/graphql/directives/rateLimit.directive.ts` |

## 10. AI / GenAI Technologies

| Skill | Implementation | Location |
|---|---|---|
| Text embeddings (OpenAI) | `text-embedding-3-large`, 1536-dim, batch 100 | `packages/ai/src/embeddings/openai.embedder.ts` |
| Text embeddings (Bedrock Titan) | Fallback implementation | `packages/ai/src/embeddings/bedrock.embedder.ts` |
| Embedding cache | Redis `emb:{sha256(text)}`, 7-day TTL | `packages/ai/src/cache/embedding.cache.ts` |
| Atlas Vector Search | HNSW cosine similarity, `$vectorSearch` | `packages/ai/src/vector-search/atlas-vector.ts` |
| RAG (product Q&A) | Vector retrieval → LLM answer | `packages/ai/src/chains/product-qa.chain.ts` |
| Personalized recommendations | User profile embedding similarity | `packages/ai/src/chains/recommendation.chain.ts` |
| AI product descriptions | GPT-4o/Claude prompt chain | `packages/ai/src/chains/description-gen.chain.ts` |
| LLM review summarization | Multi-review synthesis | `packages/ai/src/chains/review-summary.chain.ts` |
| Prompt engineering | Structured system+user prompts | `packages/ai/src/prompts/` |
| RAG audit logging | `AIQuery` collection, 90-day TTL | `packages/db/src/models/AIQuery.model.ts` |
| Semantic search | Query → embedding → vector similarity | `apps/api/src/graphql/resolvers/ai.resolver.ts` |
