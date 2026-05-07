import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecommendationChain } from './recommendation.chain.js';

// Mock db aggregations
vi.mock('@ecom/db', () => ({
  ProductModel: {
    aggregate: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
    find: vi.fn().mockReturnValue({ lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }) }),
  },
  OrderModel: {
    aggregate: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
  },
  buildVectorSearchPipeline: vi.fn().mockReturnValue([]),
  buildFrequentlyBoughtTogetherPipeline: vi.fn().mockReturnValue([]),
}));

vi.mock('../embeddings/factory.js', () => ({
  EmbedderFactory: {
    create: vi.fn().mockReturnValue({
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    }),
  },
}));

describe('RecommendationChain', () => {
  let chain: RecommendationChain;

  beforeEach(() => {
    vi.clearAllMocks();
    chain = new RecommendationChain();
  });

  it('personalized() calls buildVectorSearchPipeline with profile embedding', async () => {
    const { buildVectorSearchPipeline } = await import('@ecom/db');
    const profile = [0.1, 0.2, 0.3];
    await chain.personalized(profile, 5);
    expect(buildVectorSearchPipeline).toHaveBeenCalledWith(profile, 5, 50);
  });

  it('frequentlyBoughtTogether() calls buildFrequentlyBoughtTogetherPipeline', async () => {
    const { buildFrequentlyBoughtTogetherPipeline } = await import('@ecom/db');
    await chain.frequentlyBoughtTogether('product-123', 5);
    expect(buildFrequentlyBoughtTogetherPipeline).toHaveBeenCalledWith('product-123', 5);
  });

  it('trending() returns empty array when no orders exist', async () => {
    const result = await chain.trending(10);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('similarProducts() generates embedding when product has none', async () => {
    const { EmbedderFactory } = await import('../embeddings/factory.js');
    const product = { _id: 'prod-1', name: 'Widget', description: 'A widget', tags: ['gadget'] };
    await chain.similarProducts(product, 5);
    expect(EmbedderFactory.create).toHaveBeenCalled();
  });

  it('similarProducts() uses stored embedding when available', async () => {
    const { EmbedderFactory } = await import('../embeddings/factory.js');
    const stored = [0.9, 0.1, 0.0];
    const product = { _id: 'prod-1', embedding: stored };
    await chain.similarProducts(product, 5);
    // EmbedderFactory should NOT be called since embedding already exists
    expect(EmbedderFactory.create).not.toHaveBeenCalled();
  });
});
