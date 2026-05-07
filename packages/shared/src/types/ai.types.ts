export type AIProvider = 'openai' | 'bedrock';
export type AIFeedback = 'helpful' | 'not_helpful';
export type QueryType = 'product_qa' | 'recommendation' | 'search';
export type RecommendationStrategy =
  | 'SIMILAR_PRODUCTS'
  | 'PERSONALIZED'
  | 'TRENDING'
  | 'FREQUENTLY_BOUGHT_TOGETHER';

export interface IContextDoc {
  productId: string;
  score: number;
  contentSnippet: string;
}

export interface IAIQueryResult {
  answer: string;
  contextProducts: Array<{ id: string; name: string; score: number }>;
  confidence?: number;
  traceId: string;
  latencyMs: number;
}

export interface IRecommendationResult {
  products: Array<{ id: string; name: string; score: number }>;
  reason: string;
  strategy: RecommendationStrategy;
}

export interface IEmbeddingResult {
  embedding: number[];
  model: string;
  promptTokens: number;
}

export interface IAIQuery {
  id: string;
  userId?: string;
  sessionId: string;
  queryType: QueryType;
  query: string;
  queryEmbedding: number[];
  contextDocs: IContextDoc[];
  llmModel: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  response: string;
  feedback?: AIFeedback;
  traceId: string;
  createdAt: Date;
}
