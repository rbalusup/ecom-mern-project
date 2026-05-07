terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "env"              { type = string }
variable "event_bus_arn"    { type = string }
variable "sqs_queue_arns"   { type = map(string) }
variable "sns_ops_alert_arn" { type = string }
variable "s3_bucket_arns"   { type = list(string), default = [] }

# ─── Lambda execution role ────────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals { type = "Service", identifiers = ["lambda.amazonaws.com"] }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "ecom-lambda-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = { Environment = var.env }
}

# CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# VPC access (ENI management for Lambda in VPC)
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# X-Ray active tracing
resource "aws_iam_role_policy_attachment" "lambda_xray" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# SQS consume (for event source mappings)
data "aws_iam_policy_document" "sqs_consume" {
  statement {
    sid     = "SQSConsume"
    actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = values(var.sqs_queue_arns)
  }
}

resource "aws_iam_policy" "sqs_consume" {
  name   = "ecom-lambda-sqs-${var.env}"
  policy = data.aws_iam_policy_document.sqs_consume.json
}

resource "aws_iam_role_policy_attachment" "sqs_consume" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.sqs_consume.arn
}

# EventBridge publish
data "aws_iam_policy_document" "eventbridge_publish" {
  statement {
    sid     = "EventBridgePublish"
    actions = ["events:PutEvents"]
    resources = [var.event_bus_arn]
  }
}

resource "aws_iam_policy" "eventbridge_publish" {
  name   = "ecom-lambda-eventbridge-${var.env}"
  policy = data.aws_iam_policy_document.eventbridge_publish.json
}

resource "aws_iam_role_policy_attachment" "eventbridge_publish" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.eventbridge_publish.arn
}

# SNS publish (ops alerts)
data "aws_iam_policy_document" "sns_publish" {
  statement {
    sid     = "SNSPublish"
    actions = ["sns:Publish"]
    resources = [var.sns_ops_alert_arn]
  }
}

resource "aws_iam_policy" "sns_publish" {
  name   = "ecom-lambda-sns-${var.env}"
  policy = data.aws_iam_policy_document.sns_publish.json
}

resource "aws_iam_role_policy_attachment" "sns_publish" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.sns_publish.arn
}

# S3 read/write for ingestion functions
data "aws_iam_policy_document" "s3_access" {
  count = length(var.s3_bucket_arns) > 0 ? 1 : 0
  statement {
    sid     = "S3Access"
    actions = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
    resources = concat(var.s3_bucket_arns, [for arn in var.s3_bucket_arns : "${arn}/*"])
  }
}

resource "aws_iam_policy" "s3_access" {
  count  = length(var.s3_bucket_arns) > 0 ? 1 : 0
  name   = "ecom-lambda-s3-${var.env}"
  policy = data.aws_iam_policy_document.s3_access[0].json
}

resource "aws_iam_role_policy_attachment" "s3_access" {
  count      = length(var.s3_bucket_arns) > 0 ? 1 : 0
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.s3_access[0].arn
}

# Secrets Manager (MongoDB URI, Kafka credentials)
data "aws_iam_policy_document" "secrets" {
  statement {
    sid     = "SecretsAccess"
    actions = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:*:*:secret:ecom/${var.env}/*"]
  }
}

resource "aws_iam_policy" "secrets" {
  name   = "ecom-lambda-secrets-${var.env}"
  policy = data.aws_iam_policy_document.secrets.json
}

resource "aws_iam_role_policy_attachment" "secrets" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.secrets.arn
}

output "lambda_role_arn"  { value = aws_iam_role.lambda.arn }
output "lambda_role_name" { value = aws_iam_role.lambda.name }
