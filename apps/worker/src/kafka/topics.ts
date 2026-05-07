export const KAFKA_TOPICS = {
  INVENTORY_UPDATES: 'ecom.inventory.updates',
  ORDER_EVENTS: 'ecom.order.events',
  PRODUCT_EVENTS: 'ecom.product.events',
  AI_TELEMETRY: 'ecom.ai.telemetry',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

// Partition count configuration mirrors the plan (MSK production settings)
export const TOPIC_PARTITIONS: Record<KafkaTopic, number> = {
  'ecom.inventory.updates': 12,
  'ecom.order.events': 24,
  'ecom.product.events': 12,
  'ecom.ai.telemetry': 6,
};
