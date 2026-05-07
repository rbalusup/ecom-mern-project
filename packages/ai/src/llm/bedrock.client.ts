import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

import type { ChatMessage, ILLMClient, LLMOptions, LLMResponse } from './interface.js';

// Claude 3 Haiku on Bedrock — cost-efficient default; override via BEDROCK_LLM_MODEL
const DEFAULT_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';

interface AnthropicRequestBody {
  anthropic_version: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface AnthropicResponseBody {
  id: string;
  model: string;
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

export class BedrockLLMClient implements ILLMClient {
  private client: BedrockRuntimeClient;
  private model: string;

  constructor(region?: string, model?: string) {
    this.client = new BedrockRuntimeClient({
      region: region ?? process.env['AWS_REGION'] ?? 'us-east-1',
    });
    this.model = model ?? process.env['BEDROCK_LLM_MODEL'] ?? DEFAULT_MODEL;
  }

  async complete(messages: ChatMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const conversationMsgs = messages.filter((m) => m.role !== 'system');

    const body: AnthropicRequestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options.maxTokens ?? 1024,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(systemMsg !== undefined && { system: systemMsg.content }),
      messages: conversationMsgs.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    };

    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    });

    const response = await this.client.send(command);
    const result = JSON.parse(Buffer.from(response.body).toString('utf-8')) as AnthropicResponseBody;

    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    if (!text) throw new Error('Empty response from Bedrock');

    return {
      content: text,
      model: result.model,
      promptTokens: result.usage.input_tokens,
      completionTokens: result.usage.output_tokens,
    };
  }
}
