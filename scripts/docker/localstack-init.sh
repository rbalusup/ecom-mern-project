#!/bin/bash
# LocalStack initialization — creates SQS queues, SNS topics, S3 buckets, EventBridge bus

set -e
REGION=us-east-1
ACCOUNT=000000000000
ENV=dev

echo "==> Creating SQS queues..."

QUEUES=(
  "ecom-order-processor-${ENV}"
  "ecom-embedding-generator-${ENV}"
  "ecom-notification-${ENV}"
  "ecom-review-summarizer-${ENV}"
  "ecom-search-index-sync-${ENV}"
  "ecom-dlq-processor-${ENV}"
  "ecom-order-processor-${ENV}-dlq"
  "ecom-embedding-generator-${ENV}-dlq"
  "ecom-notification-${ENV}-dlq"
  "ecom-review-summarizer-${ENV}-dlq"
  "ecom-search-index-sync-${ENV}-dlq"
)

for QUEUE in "${QUEUES[@]}"; do
  awslocal sqs create-queue \
    --queue-name "$QUEUE" \
    --region "$REGION" \
    --attributes VisibilityTimeout=300,MessageRetentionPeriod=86400 \
    --output text
  echo "  Created queue: $QUEUE"
done

echo "==> Creating SNS topics..."
awslocal sns create-topic --name "ecom-notifications-${ENV}" --region "$REGION" --output text
awslocal sns create-topic --name "ecom-ops-alerts-${ENV}" --region "$REGION" --output text

echo "==> Creating S3 buckets..."
awslocal s3 mb "s3://ecom-product-assets-${ENV}" --region "$REGION"
awslocal s3 mb "s3://ecom-lambda-artifacts-${ENV}" --region "$REGION"
awslocal s3 mb "s3://ecom-order-snapshots-${ENV}" --region "$REGION"

echo "==> Creating EventBridge bus..."
awslocal events create-event-bus --name "ecom-genai-${ENV}" --region "$REGION" --output text

echo "==> LocalStack initialization complete"
