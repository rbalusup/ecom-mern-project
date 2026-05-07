# Architecture Overview — E-Commerce GenAI Lens

## System Context

The platform is an AI-augmented e-commerce backend where:
- Products have semantic embeddings enabling natural-language search
- An LLM answers customer questions about products (RAG pattern)
- Recommendations are personalized via user preference vector similarity
- Orders flow through an event-sourced state machine
- All infrastructure is serverless on AWS

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Clients                             │
│          (web app, mobile, partner APIs)                 │
└─────────────────────┬───────────────────────────────────┘
                       │ HTTPS
┌─────────────────────▼───────────────────────────────────┐
│              API Gateway v2 (HTTP API)                   │
│              + WAF (prod) + Custom Domain                │
└─────────────────────┬───────────────────────────────────┘
                       │ Lambda proxy
┌─────────────────────▼───────────────────────────────────┐
│         apps/api (Lambda) — Apollo Server 4              │
│         • GraphQL — all queries/mutations/subscriptions  │
│         • JSON-RPC 2.0 bridge (POST /rpc)               │
│         • @auth directive (Cognito JWT)                  │
│         • @rateLimit directive (Redis sliding window)    │
│         • DataLoaders (N+1 prevention)                   │
│         • Redis caching (product 5min, category 30min)  │
└──┬─────────────────────────────────────────────────────┘
   │                 │                    │
   ▼                 ▼                    ▼
MongoDB Atlas    EventBridge           Redis
(data store)   (event bus)          (cache + idempotency)
   │                 │
   │          ┌──────┴──────────────────────┐
   │          ▼                              ▼
   │       SQS Queues                    Kafka (MSK)
   │    (order, embedding,             (inventory, orders,
   │     notification, etc.)            products, ai-telemetry)
   │          │
   │    ┌─────▼──────────────────────────┐
   │    │   apps/worker (Lambda)          │
   │    │   • Order state transitions     │
   │    │   • Embedding generation        │
   │    │   • Review summarization        │
   │    │   • Notifications               │
   │    │   • DLQ processing              │
   │    └─────┬──────────────────────────┘
   │          │
   └──────────┤
              ▼
         packages/ai
         • OpenAI / Bedrock embeddings
         • Atlas Vector Search
         • RAG chains (LangChain.js)
         • LLM (GPT-4o / Claude)
```

## Data Flow: Order Creation

```
GraphQL mutation createOrder
  → validate items, check inventory (MongoDB)
  → reserve inventory (atomic $inc)
  → create Order document (status: pending_payment)
  → publish order.created → EventBridge
  → EventBridge routes to:
      SQS order-processor → worker processes payment
      SNS notification → customer email
  → Worker: payment → order.status.changed (confirmed)
  → OrderEvent written (idempotency key)
  → EventBridge: order.status.changed
  → Kafka: ecom.order.events (for analytics)
  → WebSocket subscription push to client
```

## Data Flow: Semantic Search (RAG)

```
GraphQL query askProduct(id, "is this waterproof?")
  → Embed question (OpenAI text-embedding-3-large)
    - Check Redis cache first (emb:{sha256(question)})
  → $vectorSearch on products.embedding (Atlas)
    - numCandidates: 100, limit: 5, threshold: 0.7
  → Build context: name + description + attributes of top docs
  → LLM call (GPT-4o): system prompt + context + question
  → Return AIQueryResult: answer + contextProducts + traceId
  → Persist AIQuery document (audit trail, 90-day TTL)
  → Emit ai.query.completed → EventBridge → CloudWatch metrics
```

## Package Dependency Graph

```
apps/api         → packages/db, packages/ai, packages/shared, packages/observability
apps/worker      → packages/db, packages/ai, packages/shared, packages/observability
apps/ingestion   → packages/db, packages/ai, packages/shared, packages/observability
packages/db      → packages/shared
packages/ai      → packages/shared, packages/observability
packages/observability → (no internal deps)
packages/shared  → (no internal deps)
```

## MongoDB Schema Design Decisions

### Product Embedding Strategy
Embeddings (1536-dim) are stored directly in the `products` collection alongside the document data. This co-location means a single query retrieves both the document and its vector neighborhood, eliminating a cross-service network hop for RAG context retrieval. The `embedding` field is excluded from default projections (`select: false`) to avoid sending 12KB per document in non-AI queries.

### Order Event Sourcing
Every order state transition produces an `OrderEvent` document in a separate collection. This provides: audit trail, replay capability, idempotency via unique `idempotencyKey`, and a clean event stream for Kafka publishing. The `Order` document holds the current state snapshot for query efficiency.

### Cart TTL
Carts expire after 30 days of inactivity via MongoDB TTL index. Abandoned cart analytics are read from Kafka before the TTL fires.

## Scalability Considerations

### Horizontal Scaling
- Lambda auto-scales to thousands of concurrent executions
- MongoDB Atlas scales vertically (M10 → M50+ → M200) and horizontally via sharding
- Shard key: `categoryId` for products (co-locates category browsing), `customerId` for orders (co-locates customer queries)
- Redis ElastiCache: read replicas in prod

### Throughput Limits
| Component | Dev | Prod Target |
|---|---|---|
| API Gateway | 10K RPS | 50K RPS |
| Lambda concurrency | 100 | 3000 (reserved) |
| MongoDB Atlas | M10 (~500 ops/s) | M50+ (~5000 ops/s) |
| Redis | t4g.micro | r7g.large (13GB RAM) |
| Kafka | 1 broker (t3.small) | 3 brokers (m5.large) |

## Security Architecture

- **Auth**: AWS Cognito User Pool → JWT → Cognito-verified in `@auth` directive
- **Transport**: TLS everywhere (API Gateway, MongoDB TLS, Redis TLS in prod)
- **Secrets**: No env var secrets in Lambda — all read from AWS Secrets Manager at cold start
- **IAM**: Lambda execution roles with least-privilege (no `*` actions)
- **WAF**: AWS WAF on API Gateway in prod (SQL injection, XSS, rate limiting)
- **VPC**: Lambda, Redis, MSK all in private subnets — no public exposure
- **Atlas**: VPC peering — MongoDB not accessible from internet

## Observability Architecture

```
All services → Pino JSON logs → CloudWatch Logs
All services → OTel SDK → OTLP → CloudWatch X-Ray
All services → OTel Metrics / EMF → CloudWatch Metrics
CloudWatch Metrics → Alarms → SNS ops-alert → PagerDuty
```

See [docs/ADR/005-opentelemetry-over-xray-sdk.md](ADR/005-opentelemetry-over-xray-sdk.md) for the OTel decision rationale.
