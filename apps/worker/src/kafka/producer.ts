import { Kafka, type Producer, CompressionTypes } from 'kafkajs';
import { context, propagation, trace } from '@opentelemetry/api';

import type { KafkaTopic } from './topics.js';

interface ProduceOptions {
  key?: string;
  value: string;
  headers?: Record<string, string>;
  partition?: number;
}

let _producer: Producer | null = null;

function buildKafka(): Kafka {
  const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
  const ssl = process.env['KAFKA_SSL'] === 'true';
  const saslUsername = process.env['KAFKA_SASL_USERNAME'];
  const saslPassword = process.env['KAFKA_SASL_PASSWORD'];

  return new Kafka({
    clientId: `ecom-worker-${process.env['NODE_ENV'] ?? 'dev'}`,
    brokers,
    ssl,
    ...(saslUsername && saslPassword && {
      sasl: { mechanism: 'scram-sha-512', username: saslUsername, password: saslPassword },
    }),
  });
}

async function getProducer(): Promise<Producer> {
  if (!_producer) {
    const kafka = buildKafka();
    _producer = kafka.producer({
      idempotent: true, // exactly-once delivery semantics
      maxInFlightRequests: 5,
    });
    await _producer.connect();
  }
  return _producer;
}

export const KafkaProducer = {
  /**
   * Publishes a single message to a Kafka topic.
   * Injects OTel trace context into message headers for end-to-end tracing.
   */
  async publish(topic: KafkaTopic, options: ProduceOptions): Promise<void> {
    const producer = await getProducer();

    // Inject trace context into headers
    const carrier: Record<string, string> = { ...(options.headers ?? {}) };
    propagation.inject(context.active(), carrier);

    // Attach current span ID for Kafka header tracing
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (spanContext) {
      carrier['traceparent'] = `00-${spanContext.traceId}-${spanContext.spanId}-01`;
    }

    await producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: options.key ?? null,
          value: options.value,
          ...(options.partition !== undefined && { partition: options.partition }),
          headers: Object.fromEntries(
            Object.entries(carrier).map(([k, v]) => [k, Buffer.from(v)]),
          ),
        },
      ],
    });
  },

  async disconnect(): Promise<void> {
    if (_producer) {
      await _producer.disconnect();
      _producer = null;
    }
  },
};
