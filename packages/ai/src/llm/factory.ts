import { BedrockLLMClient } from './bedrock.client.js';
import type { ILLMClient } from './interface.js';
import { OpenAILLMClient } from './openai.client.js';

export class LLMFactory {
  /**
   * Creates an LLM client based on AI_PROVIDER env var ('openai' | 'bedrock').
   */
  static create(): ILLMClient {
    const provider = process.env['AI_PROVIDER'] ?? 'openai';
    return provider === 'bedrock' ? new BedrockLLMClient() : new OpenAILLMClient();
  }
}
