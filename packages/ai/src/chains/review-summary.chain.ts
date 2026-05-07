import { LLMFactory } from '../llm/factory.js';
import { buildReviewSummaryPrompt, REVIEW_SUMMARY_SYSTEM_PROMPT } from '../prompts/review-summary.prompt.js';

export interface ReviewInput {
  rating: number;
  title?: string | undefined;
  body?: string | undefined;
}

export class ReviewSummaryChain {
  async summarize(reviews: ReviewInput[]): Promise<string> {
    if (reviews.length < 3) {
      throw new Error('Minimum 3 reviews required for a meaningful summary');
    }

    const llm = LLMFactory.create();

    const reviewText = reviews
      .map((r) => `Rating: ${r.rating}/5\nTitle: ${r.title ?? ''}\nReview: ${r.body ?? ''}`)
      .join('\n---\n');

    const response = await llm.complete(
      [
        { role: 'system', content: REVIEW_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: buildReviewSummaryPrompt(reviewText, reviews.length) },
      ],
      { maxTokens: 256, temperature: 0.3 },
    );

    return response.content;
  }
}
