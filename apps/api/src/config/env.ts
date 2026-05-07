import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // MongoDB
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().default('ecom-genai-dev'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_TLS: z.coerce.boolean().default(false),

  // Auth
  COGNITO_USER_POOL_ID: z.string().default('us-east-1_local'),
  COGNITO_CLIENT_ID: z.string().default('local-client-id'),
  JWT_SECRET: z.string().min(16),

  // AWS
  AWS_REGION: z.string().default('us-east-1'),
  SQS_ORDER_PROCESSOR_URL: z.string().optional(),
  SQS_EMBEDDING_GENERATOR_URL: z.string().optional(),
  EVENTBRIDGE_BUS_NAME: z.string().default('ecom-genai-dev'),
  AWS_ENDPOINT_URL: z.string().optional(), // LocalStack

  // AI
  AI_PROVIDER: z.enum(['openai', 'bedrock']).default('openai'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o'),

  // Observability
  OTEL_SERVICE_NAME: z.string().default('ecom-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4317'),

  // GraphQL
  GRAPHQL_MAX_COMPLEXITY: z.coerce.number().default(50),
  GRAPHQL_MAX_DEPTH: z.coerce.number().default(7),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.flatten().fieldErrors;
    throw new Error(`Invalid environment variables:\n${JSON.stringify(issues, null, 2)}`);
  }
  _env = result.data;
  return _env;
}

// Reset for testing
export function resetEnv(): void {
  _env = null;
}
