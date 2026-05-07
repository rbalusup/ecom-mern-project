/**
 * Creates (or verifies) the Atlas Search text index on the products collection.
 * Run once per environment: `pnpm tsx scripts/atlas/create-search-index.ts`
 *
 * Required env vars: ATLAS_PROJECT_ID, ATLAS_CLUSTER_NAME, ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY, MONGODB_DB_NAME
 */

const ATLAS_BASE = 'https://cloud.mongodb.com/api/atlas/v1.0';

const INDEX_DEF = {
  name: 'product-text-search',
  analyzer: 'lucene.standard',
  mappings: {
    dynamic: false,
    fields: {
      name: [
        {
          type: 'string',
          analyzer: 'lucene.standard',
          multi: { keywordAnalyzer: { type: 'string', analyzer: 'lucene.keyword' } },
        },
      ],
      description: [{ type: 'string', analyzer: 'lucene.standard' }],
      tags: [{ type: 'string', analyzer: 'lucene.standard' }],
      aiDescription: [{ type: 'string', analyzer: 'lucene.standard' }],
      status: [{ type: 'string', analyzer: 'lucene.keyword' }],
      categoryId: [{ type: 'string', analyzer: 'lucene.keyword' }],
    },
  },
};

async function main() {
  const projectId = process.env['ATLAS_PROJECT_ID'];
  const clusterName = process.env['ATLAS_CLUSTER_NAME'];
  const publicKey = process.env['ATLAS_PUBLIC_KEY'];
  const privateKey = process.env['ATLAS_PRIVATE_KEY'];
  const dbName = process.env['MONGODB_DB_NAME'] ?? 'ecom';

  if (!projectId || !clusterName || !publicKey || !privateKey) {
    console.error(
      'Missing required env vars: ATLAS_PROJECT_ID, ATLAS_CLUSTER_NAME, ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY',
    );
    process.exit(1);
  }

  const auth = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
  const url = `${ATLAS_BASE}/groups/${projectId}/clusters/${clusterName}/fts/indexes/${dbName}/products`;

  console.log(`Creating Atlas Search text index "${INDEX_DEF.name}" on ${dbName}.products …`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(INDEX_DEF),
  });

  if (res.status === 409) {
    console.log('Index already exists — no action needed.');
    return;
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`Failed (HTTP ${res.status}): ${body}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log('Index creation initiated:', JSON.stringify(result, null, 2));
  console.log('Allow ~2 minutes for the index to build before querying.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
