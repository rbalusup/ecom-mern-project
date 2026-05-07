export const REVIEW_SUMMARY_SYSTEM_PROMPT = `You are an expert at synthesizing customer feedback.
Summarize the key themes, pros, cons, and overall sentiment from the reviews provided.
Be balanced and objective. Keep the summary under 150 words.
Structure: start with overall sentiment, then 2-3 strengths, then 1-2 drawbacks (if any), end with who the product suits best.`;

export function buildReviewSummaryPrompt(reviewText: string, count: number): string {
  return `Analyze these ${count} customer reviews and provide a balanced summary:\n\n${reviewText}\n\nSummary:`;
}
