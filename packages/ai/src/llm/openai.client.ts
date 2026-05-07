import OpenAI from 'openai';

import type { ChatMessage, ILLMClient, LLMOptions, LLMResponse } from './interface.js';

const DEFAULT_MODEL = 'gpt-4o';

export class OpenAILLMClient implements ILLMClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey?: string, model = DEFAULT_MODEL) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });
    this.model = model;
  }

  async complete(messages: ChatMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
    });

    const choice = response.choices[0];
    if (!choice?.message.content) throw new Error('Empty response from OpenAI');

    return {
      content: choice.message.content,
      model: response.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
