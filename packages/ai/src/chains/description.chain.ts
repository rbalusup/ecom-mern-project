import { LLMFactory } from '../llm/factory.js';
import { buildDescriptionPrompt, DESCRIPTION_SYSTEM_PROMPT } from '../prompts/description.prompt.js';

interface ProductInput {
  name?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  attributes?: unknown;
}

export class DescriptionChain {
  async generate(product: ProductInput): Promise<string> {
    const llm = LLMFactory.create();

    const response = await llm.complete(
      [
        { role: 'system', content: DESCRIPTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildDescriptionPrompt({
            name: product.name ?? 'Unknown Product',
            description: product.description,
            tags: product.tags,
            attributes:
              product.attributes !== null &&
              typeof product.attributes === 'object' &&
              !Array.isArray(product.attributes)
                ? (product.attributes as Record<string, unknown>)
                : undefined,
          }),
        },
      ],
      { maxTokens: 300, temperature: 0.7 },
    );

    return response.content;
  }
}
