import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// JSON-RPC 2.0 bridge: wraps named GraphQL operations for legacy/partner clients.
// POST /rpc  { jsonrpc: "2.0", id: 1, method: "searchProducts", params: { query: "...", first: 10 } }

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Map of allowed RPC method → GraphQL operation name.
// Add to this list to expose more operations over RPC.
const ALLOWED_METHODS: Record<string, { query: string; variables?: (params: Record<string, unknown>) => Record<string, unknown> }> = {
  searchProducts: {
    query: `query SearchProducts($query: String!, $first: Int, $after: String) {
      searchProducts(query: $query, first: $first, after: $after) {
        edges { node { id sku name slug price { base discountedPrice } rating { average count } images { url isPrimary } } cursor }
        pageInfo { hasNextPage endCursor }
        totalCount
      }
    }`,
  },
  getProduct: {
    query: `query GetProduct($id: ID!) { product(id: $id) { id sku name slug description price { base discountedPrice } rating { average count } images { url isPrimary } } }`,
    variables: (p) => ({ id: p['id'] }),
  },
  semanticSearch: {
    query: `query SemanticSearch($query: String!, $limit: Int) { semanticSearch(query: $query, limit: $limit) { id sku name slug price { base discountedPrice } } }`,
  },
  getCategories: {
    query: `query GetCategories($parentId: ID) { categories(parentId: $parentId) { id name slug level } }`,
    variables: (p) => ({ parentId: p['parentId'] }),
  },
};

export async function jsonRpcRoutes(app: FastifyInstance) {
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as JsonRpcRequest | JsonRpcRequest[] | unknown;

    if (Array.isArray(body)) {
      const results = await Promise.all(body.map((req) => handleSingleRequest(req as JsonRpcRequest, request)));
      return reply.send(results);
    }

    const result = await handleSingleRequest(body as JsonRpcRequest, request);
    return reply.send(result);
  });
}

async function handleSingleRequest(rpc: JsonRpcRequest, fastifyRequest: FastifyRequest): Promise<JsonRpcResponse> {
  if (rpc.jsonrpc !== '2.0') {
    return error(rpc.id ?? null, -32600, 'Invalid JSON-RPC version — must be "2.0"');
  }

  const operation = ALLOWED_METHODS[rpc.method];
  if (!operation) {
    return error(rpc.id ?? null, -32601, `Method "${rpc.method}" not found`);
  }

  try {
    const params = rpc.params ?? {};
    const variables = operation.variables ? operation.variables(params) : params;

    // Forward to the GraphQL endpoint within the same process
    const graphqlResponse = await (fastifyRequest.server as FastifyInstance & {
      inject?: (opts: {
        method: string;
        url: string;
        headers: Record<string, string>;
        payload: unknown;
      }) => Promise<{ statusCode: number; json: () => { data?: unknown; errors?: { message: string }[] } }>;
    }).inject?.({
      method: 'POST',
      url: '/graphql',
      headers: {
        'content-type': 'application/json',
        ...(fastifyRequest.headers.authorization && { authorization: fastifyRequest.headers.authorization as string }),
        ...(fastifyRequest.headers['x-correlation-id'] && { 'x-correlation-id': fastifyRequest.headers['x-correlation-id'] as string }),
      },
      payload: { query: operation.query, variables },
    });

    if (!graphqlResponse) {
      return error(rpc.id ?? null, -32603, 'Internal GraphQL execution error');
    }

    const gqlResult = graphqlResponse.json();

    if (gqlResult.errors?.length) {
      return error(rpc.id ?? null, -32000, gqlResult.errors[0]!.message, gqlResult.errors);
    }

    return { jsonrpc: '2.0', id: rpc.id ?? null, result: gqlResult.data };
  } catch (err) {
    return error(rpc.id ?? null, -32603, err instanceof Error ? err.message : 'Internal error');
  }
}

function error(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined && { data }) } };
}
