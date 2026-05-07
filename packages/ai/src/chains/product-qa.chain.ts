// Phase 2 stub — RAG implementation in Phase 4
export class ProductQAChain {
  async ask(
    productId: string,
    question: string,
    _options?: { traceId?: string; userId?: string },
  ): Promise<{ id: string; answer: string; contextProducts: unknown[]; latencyMs: number; traceId: string | null }> {
    return {
      id: `qa-${Date.now()}`,
      answer: `[Phase 4 stub] Question about product ${productId}: ${question}`,
      contextProducts: [],
      latencyMs: 0,
      traceId: _options?.traceId ?? null,
    };
  }
}
