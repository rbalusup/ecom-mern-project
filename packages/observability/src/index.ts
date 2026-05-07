export { createLogger, rootLogger, type Logger, type LogContext } from './logger.js';
export { initTracer, getTracer, getCurrentSpan, getTraceId, getSpanId, trace, context } from './tracer.js';
export {
  recordOrderCreated,
  recordAIQuery,
  recordAILatency,
  recordEmbeddingLatency,
  recordResolverLatency,
  emitEMFMetric,
} from './metrics.js';
export {
  generateCorrelationId,
  extractTraceContext,
  injectTraceContext,
  buildSQSMessageAttributes,
  extractSQSTraceContext,
} from './correlation.js';
