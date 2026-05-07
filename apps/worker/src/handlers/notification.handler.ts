/**
 * Processes notification events from the ecom-notification FIFO queue.
 * FIFO ensures per-customer ordering (MessageGroupId = customerId).
 *
 * Responsibility: route domain events to the appropriate notification channel
 * (email, push, in-app). Real transports wired in Phase 6; this layer handles
 * routing + logging + idempotency so transport swaps require no structural change.
 */

import type { SQSRecord } from 'aws-lambda';

import { createSQSHandler, type SQSHandlerContext } from '../processors/sqs-base.handler.js';

interface NotificationEvent {
  type:
    | 'ORDER_CONFIRMED'
    | 'ORDER_SHIPPED'
    | 'ORDER_DELIVERED'
    | 'ORDER_CANCELLED'
    | 'PAYMENT_FAILED'
    | 'WELCOME'
    | 'LOW_STOCK_ALERT'
    | 'REVIEW_PUBLISHED';
  customerId: string;
  payload: Record<string, unknown>;
}

async function processNotification(
  event: NotificationEvent,
  _record: SQSRecord,
  ctx: SQSHandlerContext,
): Promise<void> {
  const { type, customerId, payload } = event;
  ctx.logger.info({ type, customerId }, 'Processing notification event');

  switch (type) {
    case 'ORDER_CONFIRMED':
    case 'ORDER_SHIPPED':
    case 'ORDER_DELIVERED':
    case 'ORDER_CANCELLED':
    case 'PAYMENT_FAILED':
      await sendOrderNotification(type, customerId, payload, ctx);
      break;

    case 'WELCOME':
      await sendWelcomeNotification(customerId, payload, ctx);
      break;

    case 'LOW_STOCK_ALERT':
      await sendOpsAlert(payload, ctx);
      break;

    case 'REVIEW_PUBLISHED':
      ctx.logger.info({ customerId }, 'Review published notification queued');
      break;

    default:
      ctx.logger.warn({ type }, 'Unknown notification type');
  }
}

async function sendOrderNotification(
  type: string,
  customerId: string,
  payload: Record<string, unknown>,
  ctx: SQSHandlerContext,
): Promise<void> {
  // Phase 6 will wire SES/SendGrid; stub logs intent
  ctx.logger.info({ type, customerId, orderId: payload['orderId'] }, 'Order notification dispatched (stub)');
}

async function sendWelcomeNotification(
  customerId: string,
  payload: Record<string, unknown>,
  ctx: SQSHandlerContext,
): Promise<void> {
  ctx.logger.info({ customerId, email: payload['email'] }, 'Welcome email dispatched (stub)');
}

async function sendOpsAlert(
  payload: Record<string, unknown>,
  ctx: SQSHandlerContext,
): Promise<void> {
  // Publish to SNS ops-alert topic so PagerDuty/Slack can pick it up
  const { SNSClient, PublishCommand } = await import('@aws-sdk/client-sns');
  const sns = new SNSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
  const topicArn = process.env['SNS_OPS_ALERT_ARN'];
  if (!topicArn) {
    ctx.logger.warn('SNS_OPS_ALERT_ARN not set — skipping ops alert');
    return;
  }
  await sns.send(new PublishCommand({
    TopicArn: topicArn,
    Subject: `Low stock alert: ${payload['sku']}`,
    Message: JSON.stringify(payload),
  }));
  ctx.logger.info({ sku: payload['sku'] }, 'Ops alert published to SNS');
}

export const handler = createSQSHandler<NotificationEvent>('ecom-notification-processor', processNotification);
