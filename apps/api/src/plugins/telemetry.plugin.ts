import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { trace, context, propagation } from '@opentelemetry/api';

export const telemetryPlugin = fp(async (app: FastifyInstance) => {
  const tracer = trace.getTracer('ecom-api');

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Extract trace context from incoming headers
    const parentContext = propagation.extract(context.active(), request.headers as Record<string, string | string[]>);
    const span = tracer.startSpan(`${request.method} ${request.routerPath ?? request.url}`, {}, parentContext);

    span.setAttribute('http.method', request.method);
    span.setAttribute('http.url', request.url);
    span.setAttribute('http.request_id', request.id as string);

    // Store span in request for child spans
    (request as FastifyRequest & { span: ReturnType<typeof tracer.startSpan> }).span = span;
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const span = (request as FastifyRequest & { span?: ReturnType<typeof tracer.startSpan> }).span;
    if (span) {
      span.setAttribute('http.status_code', reply.statusCode);
      span.end();
    }
  });

  app.addHook('onError', async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
    const span = (request as FastifyRequest & { span?: ReturnType<typeof tracer.startSpan> }).span;
    if (span) {
      span.recordException(error);
    }
  });
}, { name: 'telemetry' });
