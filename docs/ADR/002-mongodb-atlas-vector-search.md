# ADR 002 — MongoDB Atlas Vector Search over Dedicated Vector DB

**Status**: Accepted  
**Date**: 2026-05-07

## Context

The platform needs vector similarity search for product recommendations, semantic search, and RAG context retrieval. Options: MongoDB Atlas Vector Search, Pinecone, Weaviate, Qdrant, pgvector.

## Decision

Use **MongoDB Atlas Vector Search** — store embeddings directly in the `products` collection.

## Rationale

**Operational simplicity**: The platform already uses MongoDB. Adding a dedicated vector DB introduces a second stateful service to operate, monitor, and keep in sync with the source-of-truth documents.

**Co-location benefit**: Embedding the vector alongside the document means a single `$vectorSearch` aggregation stage retrieves both the vector neighborhood AND the product document attributes (name, description, price) needed for RAG context. A dedicated vector DB would return IDs → second query to MongoDB → network round trip.

**Performance**: Atlas Vector Search uses HNSW index with ANN query latencies under 50ms at 1M vectors, sufficient for product catalogs of this scale.

**Cost**: No additional service cost. Atlas M10 includes Vector Search. Pinecone would add $70+/month.

**Filter support**: Atlas Vector Search supports pre-filtering on scalar fields (`status`, `categoryId`) within the HNSW graph, avoiding post-filter false-negative problem of pure ANN.

## Trade-offs

- Maximum vector dimensions: 4096 (sufficient for 1536-dim OpenAI embeddings).
- Not suitable for multi-billion vector scale (would need Pinecone or Weaviate at that scale).
- Atlas Vector Search requires Atlas cluster (not self-hosted MongoDB).

## Consequences

- All product text must be embedded before indexing.
- Vector Search index created via Atlas Admin API (not via Mongoose schema).
- `embedding` field excluded from default query projections (`select: false`).
