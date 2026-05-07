import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIEmbedder } from './openai.embedder.js';

// Mock the openai module
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

function makeEmbeddingResponse(texts: string[]) {
  return {
    data: texts.map((_, i) => ({ embedding: Array.from({ length: 1536 }, (__, j) => i * 0.001 + j * 0.0001), index: i })),
    usage: { prompt_tokens: texts.length * 5, total_tokens: texts.length * 5 },
  };
}

describe('OpenAIEmbedder', () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const openaiModule = await import('openai');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockCreate = (openaiModule as any).__mockCreate;
  });

  it('returns one embedding per input text', async () => {
    const texts = ['hello world', 'foo bar'];
    mockCreate.mockResolvedValue(makeEmbeddingResponse(texts));

    const embedder = new OpenAIEmbedder('test-key');
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1536);
    expect(result[1]).toHaveLength(1536);
  });

  it('batches requests at 100 texts per call', async () => {
    // 150 texts → should call API twice (100 + 50)
    const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);
    mockCreate
      .mockResolvedValueOnce(makeEmbeddingResponse(texts.slice(0, 100)))
      .mockResolvedValueOnce(makeEmbeddingResponse(texts.slice(100)));

    const embedder = new OpenAIEmbedder('test-key');
    const result = await embedder.embed(texts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
  });

  it('makes a single API call for fewer than 100 texts', async () => {
    const texts = ['a', 'b', 'c'];
    mockCreate.mockResolvedValue(makeEmbeddingResponse(texts));

    const embedder = new OpenAIEmbedder('test-key');
    await embedder.embed(texts);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-large', dimensions: 1536 }),
    );
  });
});
