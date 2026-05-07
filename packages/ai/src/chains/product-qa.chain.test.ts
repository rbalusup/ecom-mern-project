import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProductQAChain } from './product-qa.chain.js';

// All values used inside vi.mock factories must be inline — they are hoisted
vi.mock('../embeddings/factory.js', () => ({
  EmbedderFactory: {
    create: vi.fn().mockReturnValue({
      embed: vi.fn().mockResolvedValue([Array.from({ length: 1536 }, (_, i) => i * 0.001)]),
    }),
  },
}));

vi.mock('../llm/factory.js', () => ({
  LLMFactory: {
    create: vi.fn().mockReturnValue({
      complete: vi.fn().mockResolvedValue({
        content: 'Yes, this product is waterproof with an IP68 rating.',
        model: 'gpt-4o-mock',
        promptTokens: 100,
        completionTokens: 30,
      }),
    }),
  },
}));

vi.mock('@ecom/db', () => ({
  ProductModel: {
    aggregate: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { _id: 'prod-1', name: 'WaterProof Watch', description: 'IP68 rated watch', tags: ['waterproof'], vectorScore: 0.92 },
      ]),
    }),
    findById: vi.fn().mockReturnValue({
      lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) }),
    }),
  },
  AIQueryModel: {
    create: vi.fn().mockResolvedValue({ _id: 'audit-1' }),
  },
  buildVectorSearchPipeline: vi.fn().mockReturnValue([]),
}));

const MOCK_ANSWER = 'Yes, this product is waterproof with an IP68 rating.';

describe('ProductQAChain', () => {
  let chain: ProductQAChain;

  beforeEach(() => {
    vi.clearAllMocks();
    chain = new ProductQAChain();
  });

  it('returns an answer string', async () => {
    const result = await chain.ask('prod-1', 'Is this waterproof?');
    expect(result.answer).toBe(MOCK_ANSWER);
  });

  it('includes traceId in result when provided', async () => {
    const result = await chain.ask('prod-1', 'Is this waterproof?', { traceId: 'trace-abc' });
    expect(result.traceId).toBe('trace-abc');
  });

  it('generates its own traceId when none provided', async () => {
    const result = await chain.ask('prod-1', 'What colors are available?');
    expect(result.traceId).toBeTruthy();
    expect(typeof result.traceId).toBe('string');
  });

  it('records latencyMs >= 0', async () => {
    const result = await chain.ask('prod-1', 'Test question?');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('persists an AIQuery audit document', async () => {
    const { AIQueryModel } = await import('@ecom/db');
    await chain.ask('prod-1', 'Test question?', { userId: 'user-42' });
    expect(AIQueryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ queryType: 'product_qa', query: 'Test question?' }),
    );
  });

  it('embeds the question using EmbedderFactory', async () => {
    const { EmbedderFactory } = await import('../embeddings/factory.js');
    const embedder = EmbedderFactory.create();
    await chain.ask('prod-1', 'What materials is it made of?');
    expect(embedder.embed).toHaveBeenCalledWith(['What materials is it made of?']);
  });
});
