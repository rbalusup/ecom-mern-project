// OTel must be initialized before any other imports that instrument modules
import { initTracer } from '@ecom/observability';
import { getEnv } from './config/env.js';

const env = getEnv();

initTracer({
  serviceName: env.OTEL_SERVICE_NAME,
  env: env.NODE_ENV,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

import { buildApp } from './app.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Server listening on port ${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
