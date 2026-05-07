// OTel init must be first
import { initTracer } from '@ecom/observability';
import { getEnv } from './config/env.js';

const env = getEnv();

initTracer({
  serviceName: env.OTEL_SERVICE_NAME,
  env: env.NODE_ENV,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';

const app = await buildApp();
await app.ready();

// awsLambdaFastify returns a Lambda handler that proxies API Gateway events
export const handler = awsLambdaFastify(app, {
  binaryMimeTypes: [],
  callbackWaitsForEmptyEventLoop: false,
  enforceSecureCookies: false,
});
