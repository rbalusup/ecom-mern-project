import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';
import { propagation, context, trace } from '@opentelemetry/api';

import { createLogger } from '@ecom/observability';

import type { KafkaTopic } from './topics.js';

export interface KafkaMessageHandler {
  topic: KafkaTopic;
  handle(payload: EachMessagePayload, traceId: string | undefined): Promise<void>;
}

const logger = createLogger({
  service: 'ecom-kafka-consumer',
  env: process.env['NODE_ENV'] ?? 'production',
  level: process.env['LOG_LEVEL'] ?? 'info',
});

function buildKafka(): Kafka {
  const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
  const ssl = process.env['KAFKA_SSL'] === 'true';
  const saslUsername = process.env['KAFKA_SASL_USERNAME'];
  const saslPassword = process.env['KAFKA_SASL_PASSWORD'];

  return new Kafka({
    clientId: `ecom-consumer-${process.env['NODE_ENV'] ?? 'dev'}`,
    brokers,
    ssl,
    ...(saslUsername && saslPassword && {
      sasl: { mechanism: 'scram-sha-512', username: saslUsername, password: saslPassword },
    }),
  });
}

export class KafkaConsumerRunner {
  private consumer: Consumer;
  private handlers: Map<string, KafkaMessageHandler['handle']> = new Map();

  constructor(private readonly groupId: string) {
    const kafka = buildKafka();
    this.consumer = kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
  }

  register(handler: KafkaMessageHandler): this {
    this.handlers.set(handler.topic, handler.handle.bind(handler));
    return this;
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    logger.info({ groupId: this.groupId }, 'Kafka consumer connected');

    const topics = Array.from(this.handlers.keys());
    await this.consumer.subscribe({ topics, fromBeginning: false });

    await this.consumer.run({
      autoCommit: true,
      autoCommitInterval: 5000,
      eachMessage: async (payload: EachMessagePayload) => {
        const { topic, partition, message } = payload;
        const headers = message.headers ?? {};

        // Extract OTel trace context from Kafka headers
        const carrier: Record<string, string> = {};
        for (const [k, v] of Object.entries(headers)) {
          if (v !== undefined) carrier[k] = Buffer.isBuffer(v) ? v.toString() : String(v);
        }
        const parentCtx = propagation.extract(context.active(), carrier);
        const tracer = trace.getTracer('ecom-kafka-consumer');
        const span = tracer.startSpan(`kafka.consume ${topic}`, {}, parentCtx);

        const traceId = span.spanContext().traceId;

        const handler = this.handlers.get(topic);
        if (!handler) {
          logger.warn({ topic }, 'No handler registered for Kafka topic');
          span.end();
          return;
        }

        try {
          await handler(payload, traceId);
          logger.debug({ topic, partition, offset: message.offset }, 'Message handled');
        } catch (err) {
          logger.error({ err, topic, partition, offset: message.offset }, 'Kafka message handling failed');
          span.recordException(err as Error);
        } finally {
          span.end();
        }
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
    logger.info({ groupId: this.groupId }, 'Kafka consumer disconnected');
  }
}
