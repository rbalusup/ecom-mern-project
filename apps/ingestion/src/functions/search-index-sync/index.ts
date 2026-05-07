/**
 * Scheduled Lambda: triggers Atlas Search index rebuild when schema changes.
 * Calls the MongoDB Atlas Admin API to recreate the search index definition.
 *
 * Schedule: EventBridge cron, weekly on Sunday at 03:00 UTC.
 * Also triggered manually via EventBridge rule for on-demand rebuilds.
 */

import type { ScheduledHandler } from 'aws-lambda';

import { createLogger, initTracer } from '@ecom/observability';

initTracer({ serviceName: 'ecom-search-index-sync' });

const logger = createLogger({
  service: 'ecom-search-index-sync',
  env: process.env['NODE_ENV'] ?? 'production',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

const ATLAS_BASE = 'https://cloud.mongodb.com/api/atlas/v1.0';

// Inline index definitions — kept in sync with packages/db/src/indexes/atlas-search/
const INDEX_DEFINITIONS = [
  {
    name: 'product-text-search',
    analyzer: 'lucene.standard',
    mappings: {
      dynamic: false,
      fields: {
        name: [{ type: 'string', analyzer: 'lucene.standard', multi: { keywordAnalyzer: { type: 'string', analyzer: 'lucene.keyword' } } }],
        description: [{ type: 'string', analyzer: 'lucene.standard' }],
        tags: [{ type: 'string', analyzer: 'lucene.standard' }],
        aiDescription: [{ type: 'string', analyzer: 'lucene.standard' }],
        status: [{ type: 'string', analyzer: 'lucene.keyword' }],
        categoryId: [{ type: 'string', analyzer: 'lucene.keyword' }],
      },
    },
  },
  {
    name: 'product-vector-search',
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: 1536,
          similarity: 'cosine',
        },
        {
          type: 'filter',
          path: 'status',
        },
        {
          type: 'filter',
          path: 'categoryId',
        },
      ],
    },
  },
];

export const handler: ScheduledHandler = async () => {
  const projectId = process.env['ATLAS_PROJECT_ID'];
  const clusterId = process.env['ATLAS_CLUSTER_NAME'];
  const publicKey = process.env['ATLAS_PUBLIC_KEY'];
  const privateKey = process.env['ATLAS_PRIVATE_KEY'];

  if (!projectId || !clusterId || !publicKey || !privateKey) {
    logger.warn('Atlas API credentials not configured — skipping search index sync');
    return;
  }

  logger.info({ projectId, clusterId }, 'Starting Atlas Search index sync');

  const db = process.env['MONGODB_DB_NAME'] ?? 'ecom';
  const collection = 'products';
  const auth = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');

  for (const indexDef of INDEX_DEFINITIONS) {
    const url = `${ATLAS_BASE}/groups/${projectId}/clusters/${clusterId}/fts/indexes/${db}/${collection}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(indexDef),
    });

    if (!res.ok && res.status !== 409) {
      const body = await res.text();
      logger.error({ status: res.status, body, indexName: indexDef.name }, 'Failed to sync Atlas Search index');
    } else {
      logger.info({ indexName: indexDef.name, status: res.status }, 'Atlas Search index synced');
    }
  }
};
