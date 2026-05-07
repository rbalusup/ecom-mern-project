/**
 * Worker Lambda entry point — routes SQS events to the correct handler
 * based on the source queue ARN suffix.
 *
 * Each handler is also exported individually so Terraform can wire separate
 * Lambda functions per queue for independent scaling and IAM scoping.
 */

import { initTracer } from '@ecom/observability';

// Must be the very first call — registers OTel SDK before any other imports run
initTracer({ serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'ecom-worker' });

export { handler as orderHandler } from './handlers/order.handler.js';
export { handler as inventoryHandler } from './handlers/inventory.handler.js';
export { handler as productHandler } from './handlers/product.handler.js';
export { handler as reviewHandler } from './handlers/review.handler.js';
export { handler as notificationHandler } from './handlers/notification.handler.js';
export { handler as embeddingHandler } from './handlers/embedding.handler.js';
export { handler as dlqHandler } from './handlers/dlq.handler.js';
