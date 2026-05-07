import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { MongooseInstrumentation } from '@opentelemetry/instrumentation-mongoose';
import { trace, context, propagation, type Tracer, type Span } from '@opentelemetry/api';
// W3C propagator is registered automatically by the SDK via env OTEL_PROPAGATORS

export interface TracerConfig {
  serviceName: string;
  serviceVersion?: string;
  env?: string;
  otlpEndpoint?: string;
  samplingRate?: number;
}

let sdk: NodeSDK | null = null;

export function initTracer(config: TracerConfig): void {
  // Guard against double-init (Lambda warm containers)
  if (sdk) return;

  const resource = Resource.default().merge(
    new Resource({
      [SEMRESATTRS_SERVICE_NAME]: config.serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: config.serviceVersion ?? '0.0.0',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.env ?? 'development',
    }),
  );

  const traceExporter = new OTLPTraceExporter({
    url: config.otlpEndpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? '';
          return url === '/health' || url === '/ready' || url === '/live';
        },
      }),
      new MongooseInstrumentation({ dbStatementSerializer: (operation) => operation }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    void sdk?.shutdown();
  });
}

export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

export function getCurrentSpan(): Span | undefined {
  return trace.getActiveSpan();
}

export function getTraceId(): string | undefined {
  const span = getCurrentSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  return ctx.traceId !== '00000000000000000000000000000000' ? ctx.traceId : undefined;
}

export function getSpanId(): string | undefined {
  return getCurrentSpan()?.spanContext().spanId;
}

export { trace, context, propagation };
export type { Tracer, Span };
