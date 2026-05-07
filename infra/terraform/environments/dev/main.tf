terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    # Configured via backend.tf (not committed) or -backend-config flags in CI
    key = "ecom/dev/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags { tags = { Project = "ecom-genai", Environment = "dev", ManagedBy = "terraform" } }
}

variable "aws_region"          { type = string, default = "us-east-1" }
variable "mongodb_uri"         { type = string, sensitive = true }
variable "sns_ops_alert_email" { type = string, default = "" }

module "networking" {
  source             = "../../modules/networking"
  env                = "dev"
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  single_nat_gateway = true # Cost optimization for dev
}

module "messaging" {
  source                     = "../../modules/messaging"
  env                        = "dev"
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  sns_ops_alert_email        = var.sns_ops_alert_email
  kafka_broker_instance_type = "kafka.t3.small"
  kafka_number_of_broker_nodes = 3
}

module "iam" {
  source           = "../../modules/iam"
  env              = "dev"
  event_bus_arn    = module.messaging.event_bus_arn
  sqs_queue_arns   = module.messaging.sqs_queue_arns
  sns_ops_alert_arn = module.messaging.sns_ops_alert_arn
}

output "event_bus_name"      { value = module.messaging.event_bus_name }
output "sqs_queue_urls"      { value = module.messaging.sqs_queue_urls }
output "kafka_brokers"       { value = module.messaging.kafka_bootstrap_brokers_sasl_scram, sensitive = true }
output "lambda_role_arn"     { value = module.iam.lambda_role_arn }
