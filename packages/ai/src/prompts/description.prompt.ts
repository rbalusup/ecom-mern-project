export const DESCRIPTION_SYSTEM_PROMPT = `You are an expert e-commerce copywriter.
Generate compelling, accurate product descriptions that highlight key features and benefits.
Write in an engaging, professional tone. Keep descriptions between 100-200 words.
Focus on customer value — what problem this product solves, why it stands out.
Never invent specifications not present in the input.`;

interface DescriptionInput {
  name: string;
  description?: string | undefined;
  tags?: string[] | undefined;
  attributes?: Record<string, unknown> | undefined;
}

export function buildDescriptionPrompt(product: DescriptionInput): string {
  const lines = [`Product Name: ${product.name}`];

  if (product.description) {
    lines.push(`Current Description: ${product.description}`);
  }

  if (product.tags?.length) {
    lines.push(`Tags: ${product.tags.join(', ')}`);
  }

  if (product.attributes && Object.keys(product.attributes).length > 0) {
    const attrs = Object.entries(product.attributes)
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join('\n');
    lines.push(`Attributes:\n${attrs}`);
  }

  lines.push('\nWrite a compelling product description:');
  return lines.join('\n');
}
