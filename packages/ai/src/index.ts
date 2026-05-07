// Embeddings
export { EmbedderFactory } from './embeddings/factory.js';
export { CachedEmbedder } from './embeddings/cache.js';
export { OpenAIEmbedder } from './embeddings/openai.embedder.js';
export { BedrockEmbedder } from './embeddings/bedrock.embedder.js';
export type { IEmbedder } from './embeddings/interface.js';

// LLM
export { LLMFactory } from './llm/factory.js';
export { OpenAILLMClient } from './llm/openai.client.js';
export { BedrockLLMClient } from './llm/bedrock.client.js';
export type { ILLMClient, ChatMessage, LLMOptions, LLMResponse } from './llm/interface.js';

// Chains
export { ProductQAChain } from './chains/product-qa.chain.js';
export type { ProductQAResult } from './chains/product-qa.chain.js';
export { RecommendationChain } from './chains/recommendation.chain.js';
export { DescriptionChain } from './chains/description.chain.js';
export { ReviewSummaryChain } from './chains/review-summary.chain.js';
export type { ReviewInput } from './chains/review-summary.chain.js';
