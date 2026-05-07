import { metrics, type Meter, type Counter, type Histogram, type ObservableGauge } from '@opentelemetry/api';

let meter: Meter | null = null;

function getMeter(): Meter {
  if (!meter) {
    meter = metrics.getMeter('ecom-genai', '0.1.0');
  }
  return meter;
}

// ─── Counters ────────────────────────────────────────────────────────────────

let orderCounter: Counter | null = null;
export function recordOrderCreated(attrs: { env: string; status: string }): void {
  orderCounter ??= getMeter().createCounter('ecom.order.throughput', {
    description: 'Number of orders created',
    unit: 'count',
  });
  orderCounter.add(1, attrs);
}

let aiQueryCounter: Counter | null = null;
export function recordAIQuery(attrs: { env: string; queryType: string; model: string; cacheHit: string }): void {
  aiQueryCounter ??= getMeter().createCounter('ecom.ai.query.count', {
    description: 'Number of AI queries executed',
  });
  aiQueryCounter.add(1, attrs);
}

// ─── Histograms ──────────────────────────────────────────────────────────────

let aiLatencyHistogram: Histogram | null = null;
export function recordAILatency(latencyMs: number, attrs: { env: string; model: string; queryType: string }): void {
  aiLatencyHistogram ??= getMeter().createHistogram('ecom.ai.latency', {
    description: 'AI query end-to-end latency in milliseconds',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2000, 3000, 5000, 10000] },
  });
  aiLatencyHistogram.record(latencyMs, attrs);
}

let embeddingLatencyHistogram: Histogram | null = null;
export function recordEmbeddingLatency(latencyMs: number, attrs: { env: string; model: string }): void {
  embeddingLatencyHistogram ??= getMeter().createHistogram('ecom.embedding.generation.duration', {
    description: 'Embedding generation latency',
    unit: 'ms',
  });
  embeddingLatencyHistogram.record(latencyMs, attrs);
}

let resolverLatencyHistogram: Histogram | null = null;
export function recordResolverLatency(
  latencyMs: number,
  attrs: { env: string; resolverName: string; success: string },
): void {
  resolverLatencyHistogram ??= getMeter().createHistogram('ecom.graphql.resolver.duration', {
    description: 'GraphQL resolver execution latency',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000] },
  });
  resolverLatencyHistogram.record(latencyMs, attrs);
}

// ─── CloudWatch EMF helper (for Lambda structured metric logs) ────────────────

interface EMFMetricDimension {
  [key: string]: string;
}

interface EMFMetric {
  name: string;
  value: number;
  unit: 'Count' | 'Milliseconds' | 'Bytes' | 'Percent' | 'None';
}

export function emitEMFMetric(
  namespace: string,
  dimensions: EMFMetricDimension,
  metric: EMFMetric,
): void {
  // CloudWatch Embedded Metric Format — logs are parsed by CloudWatch agent
  const emfLog = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [Object.keys(dimensions)],
          Metrics: [{ Name: metric.name, Unit: metric.unit }],
        },
      ],
    },
    ...dimensions,
    [metric.name]: metric.value,
  };
  // Write to stdout — Lambda/CloudWatch Logs picks this up
  process.stdout.write(JSON.stringify(emfLog) + '\n');
}
