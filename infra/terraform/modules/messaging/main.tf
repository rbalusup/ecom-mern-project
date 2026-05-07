terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "env" {
  type        = string
  description = "Environment name (dev | staging | prod)"
}

variable "sns_ops_alert_email" {
  type        = string
  description = "Email address for ops alerts"
  default     = ""
}

variable "kafka_broker_instance_type" {
  type    = string
  default = "kafka.t3.small"
}

variable "kafka_number_of_broker_nodes" {
  type    = number
  default = 3
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

# ─── EventBridge Bus ──────────────────────────────────────────────────────────

resource "aws_cloudwatch_event_bus" "main" {
  name = "ecom-genai-${var.env}"

  tags = {
    Environment = var.env
    Service     = "ecom-genai"
  }
}

resource "aws_cloudwatch_event_archive" "main" {
  name             = "ecom-genai-${var.env}-archive"
  event_source_arn = aws_cloudwatch_event_bus.main.arn
  retention_days   = 30
}

# ─── SNS Topics ───────────────────────────────────────────────────────────────

resource "aws_sns_topic" "ops_alert" {
  name = "ecom-ops-alert-${var.env}"
  tags = { Environment = var.env }
}

resource "aws_sns_topic_subscription" "ops_alert_email" {
  count     = var.sns_ops_alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.ops_alert.arn
  protocol  = "email"
  endpoint  = var.sns_ops_alert_email
}

resource "aws_sns_topic" "notification" {
  name = "ecom-notification-${var.env}"
  tags = { Environment = var.env }
}

# ─── SQS Queues + DLQs ───────────────────────────────────────────────────────

locals {
  queues = {
    order_processor     = { visibility_timeout = 300, max_receive_count = 3 }
    embedding_generator = { visibility_timeout = 300, max_receive_count = 3 }
    review_summarizer   = { visibility_timeout = 300, max_receive_count = 3 }
    search_index_sync   = { visibility_timeout = 120, max_receive_count = 3 }
    dlq_processor       = { visibility_timeout = 60, max_receive_count = 1 }
  }
}

resource "aws_sqs_queue" "dlq" {
  for_each                   = local.queues
  name                       = "ecom-${replace(each.key, "_", "-")}-dlq-${var.env}"
  message_retention_seconds  = 14 * 24 * 60 * 60 # 14 days
  tags                       = { Environment = var.env }
}

resource "aws_sqs_queue" "main" {
  for_each                   = local.queues
  name                       = "ecom-${replace(each.key, "_", "-")}-${var.env}"
  visibility_timeout_seconds = each.value.visibility_timeout
  message_retention_seconds  = 4 * 24 * 60 * 60 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  })

  tags = { Environment = var.env }
}

# Notification queue — FIFO for per-customer ordering
resource "aws_sqs_queue" "notification_dlq" {
  name                      = "ecom-notification-dlq-${var.env}.fifo"
  fifo_queue                = true
  message_retention_seconds = 14 * 24 * 60 * 60
  tags                      = { Environment = var.env }
}

resource "aws_sqs_queue" "notification" {
  name                        = "ecom-notification-${var.env}.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notification_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Environment = var.env }
}

# ─── EventBridge Rules → SQS ──────────────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "order_created" {
  name           = "ecom-order-created-${var.env}"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  description    = "Route order.created events to SQS order processor"

  event_pattern = jsonencode({
    source      = ["ecom.order"]
    detail-type = ["order.created", "order.status.changed"]
  })

  tags = { Environment = var.env }
}

resource "aws_cloudwatch_event_target" "order_sqs" {
  rule           = aws_cloudwatch_event_rule.order_created.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_sqs_queue.main["order_processor"].arn
}

resource "aws_cloudwatch_event_rule" "product_events" {
  name           = "ecom-product-events-${var.env}"
  event_bus_name = aws_cloudwatch_event_bus.main.name
  description    = "Route product.created/updated to embedding generator"

  event_pattern = jsonencode({
    source      = ["ecom.product"]
    detail-type = ["product.created", "product.updated", "product.embedding.requested"]
  })

  tags = { Environment = var.env }
}

resource "aws_cloudwatch_event_target" "embedding_sqs" {
  rule           = aws_cloudwatch_event_rule.product_events.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_sqs_queue.main["embedding_generator"].arn
}

resource "aws_cloudwatch_event_rule" "review_created" {
  name           = "ecom-review-created-${var.env}"
  event_bus_name = aws_cloudwatch_event_bus.main.name

  event_pattern = jsonencode({
    source      = ["ecom.review"]
    detail-type = ["review.created", "review.summary.requested"]
  })

  tags = { Environment = var.env }
}

resource "aws_cloudwatch_event_target" "review_sqs" {
  rule           = aws_cloudwatch_event_rule.review_created.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_sqs_queue.main["review_summarizer"].arn
}

resource "aws_cloudwatch_event_rule" "inventory_low" {
  name           = "ecom-inventory-low-${var.env}"
  event_bus_name = aws_cloudwatch_event_bus.main.name

  event_pattern = jsonencode({
    source      = ["ecom.inventory"]
    detail-type = ["product.inventory.low"]
  })

  tags = { Environment = var.env }
}

resource "aws_cloudwatch_event_target" "inventory_sns" {
  rule           = aws_cloudwatch_event_rule.inventory_low.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_sns_topic.ops_alert.arn
}

# ─── SQS Queue Policies (allow EventBridge to send) ──────────────────────────

data "aws_iam_policy_document" "sqs_eventbridge" {
  for_each = toset(["order_processor", "embedding_generator", "review_summarizer", "search_index_sync"])

  statement {
    sid    = "AllowEventBridgeSend"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.main[each.key].arn]
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_bus.main.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "eventbridge" {
  for_each  = data.aws_iam_policy_document.sqs_eventbridge
  queue_url = aws_sqs_queue.main[each.key].url
  policy    = each.value.json
}

# ─── MSK Kafka Cluster ────────────────────────────────────────────────────────

resource "aws_security_group" "msk" {
  name        = "ecom-msk-${var.env}"
  description = "MSK Kafka cluster security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 9092
    to_port     = 9096
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
    description = "Kafka broker ports (plaintext + TLS + SASL)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Environment = var.env, Name = "ecom-msk-${var.env}" }
}

resource "aws_msk_cluster" "main" {
  cluster_name           = "ecom-kafka-${var.env}"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = var.kafka_number_of_broker_nodes

  broker_node_group_info {
    instance_type   = var.kafka_broker_instance_type
    client_subnets  = var.private_subnet_ids
    security_groups = [aws_security_group.msk.id]

    storage_info {
      ebs_storage_info {
        volume_size = var.env == "prod" ? 500 : 100
      }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  client_authentication {
    sasl {
      scram = true
    }
  }

  tags = { Environment = var.env }
}

# ─── MSK Topics (via null_resource with CLI) ──────────────────────────────────
# Production uses the MSK Admin API or kafkajs admin in a one-time Lambda.
# Topic creation is idempotent — safe to re-run.

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "event_bus_arn" {
  value = aws_cloudwatch_event_bus.main.arn
}

output "event_bus_name" {
  value = aws_cloudwatch_event_bus.main.name
}

output "sns_ops_alert_arn" {
  value = aws_sns_topic.ops_alert.arn
}

output "sqs_queue_urls" {
  value = merge(
    { for k, v in aws_sqs_queue.main : k => v.url },
    { notification = aws_sqs_queue.notification.url }
  )
}

output "sqs_queue_arns" {
  value = merge(
    { for k, v in aws_sqs_queue.main : k => v.arn },
    { notification = aws_sqs_queue.notification.arn }
  )
}

output "kafka_bootstrap_brokers_sasl_scram" {
  value     = aws_msk_cluster.main.bootstrap_brokers_sasl_scram
  sensitive = true
}
