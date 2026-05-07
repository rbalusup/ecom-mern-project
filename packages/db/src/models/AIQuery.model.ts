import { Schema, model, type Document, type Types } from 'mongoose';

export interface IAIQueryDocument extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  sessionId: string;
  queryType: 'product_qa' | 'recommendation' | 'search';
  query: string;
  queryEmbedding: number[];
  contextDocs: Array<{
    productId: Types.ObjectId;
    score: number;
    contentSnippet: string;
  }>;
  llmModel: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  response: string;
  feedback?: 'helpful' | 'not_helpful';
  traceId: string;
  createdAt: Date;
}

const ContextDocSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    score: { type: Number, required: true },
    contentSnippet: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const AIQuerySchema = new Schema<IAIQueryDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    sessionId: { type: String, required: true },
    queryType: {
      type: String,
      enum: ['product_qa', 'recommendation', 'search'],
      required: true,
    },
    query: { type: String, required: true, maxlength: 2000 },
    queryEmbedding: { type: [Number], required: true, select: false },
    contextDocs: { type: [ContextDocSchema], default: [] },
    llmModel: { type: String, required: true },
    promptTokens: { type: Number, default: 0, min: 0 },
    completionTokens: { type: Number, default: 0, min: 0 },
    latencyMs: { type: Number, required: true, min: 0 },
    response: { type: String, required: true, maxlength: 10000 },
    feedback: { type: String, enum: ['helpful', 'not_helpful'] },
    traceId: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'ai_queries',
  },
);

AIQuerySchema.index({ userId: 1, createdAt: -1 });
AIQuerySchema.index({ sessionId: 1, createdAt: -1 });
AIQuerySchema.index({ queryType: 1 });
AIQuerySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90-day TTL

export const AIQueryModel = model<IAIQueryDocument>('AIQuery', AIQuerySchema);
