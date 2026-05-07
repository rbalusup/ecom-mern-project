import { randomUUID } from 'crypto';

import { context, propagation, trace } from '@opentelemetry/api';

export function generateCorrelationId(): string {
  return randomUUID();
}

export function extractTraceContext(headers: Record<string, string | string[] | undefined>): {
  traceId: string | undefined;
  spanId: string | undefined;
  correlationId: string;
} {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]),
  ) as Record<string, string>;

  const ctx = propagation.extract(context.active(), normalizedHeaders);
  const span = trace.getSpan(ctx);
  const spanCtx = span?.spanContext();

  return {
    traceId: spanCtx?.traceId,
    spanId: spanCtx?.spanId,
    correlationId:
      (normalizedHeaders['x-correlation-id'] as string | undefined) ?? generateCorrelationId(),
  };
}

export function injectTraceContext(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

// Inject trace context into SQS message attributes
export function buildSQSMessageAttributes(): Record<
  string,
  { DataType: string; StringValue: string }
> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  const attrs: Record<string, { DataType: string; StringValue: string }> = {};
  for (const [key, value] of Object.entries(carrier)) {
    attrs[key] = { DataType: 'String', StringValue: value };
  }
  return attrs;
}

// Extract trace context from SQS message attributes
export function extractSQSTraceContext(
  attributes: Record<string, { DataType: string; StringValue: string }>,
): { traceId: string | undefined; spanId: string | undefined; correlationId: string } {
  const headers = Object.fromEntries(
    Object.entries(attributes).map(([k, v]) => [k, v.StringValue]),
  );
  return extractTraceContext(headers);
}
