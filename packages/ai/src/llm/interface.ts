export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ILLMClient {
  complete(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse>;
}
