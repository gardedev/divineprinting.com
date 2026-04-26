###############################################################################
# Divine Printing — Account Dashboard Infrastructure
# DynamoDB tables, Lambda functions, API Gateway, IAM roles
###############################################################################

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

variable "aws_region" {
  default = "us-east-1"
}

variable "environment" {
  default = "prod"
}

variable "snipcart_secret_api_key" {
  description = "Snipcart secret API key for webhook validation"
  type        = string
  sensitive   = true
}

variable "ses_sender_email" {
  description = "SES-verified sender email for magic links"
  default     = "noreply@divineprinting.com"
}

variable "magic_link_base_url" {
  description = "Base URL for magic link redirects"
  default     = "https://www.divineprinting.com"
}

variable "magic_link_secret" {
  description = "HMAC secret for signing magic link tokens"
  type        = string
  sensitive   = true
}

# ---------------------------------------------------------------------------
# DynamoDB Tables
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "orders" {
  name         = "divine-printing-orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }

  attribute {
    name = "customerEmail"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "CustomerEmailIndex"
    hash_key        = "customerEmail"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  tags = {
    Project     = "divine-printing"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "customers" {
  name         = "divine-printing-customers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  tags = {
    Project     = "divine-printing"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "auth_tokens" {
  name         = "divine-printing-auth-tokens"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token"

  attribute {
    name = "token"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = {
    Project     = "divine-printing"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# IAM Role for Lambda Functions
# ---------------------------------------------------------------------------

resource "aws_iam_role" "lambda_role" {
  name = "divine-printing-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "divine-printing-lambda-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = [
          aws_dynamodb_table.orders.arn,
          "${aws_dynamodb_table.orders.arn}/index/*",
          aws_dynamodb_table.customers.arn,
          aws_dynamodb_table.auth_tokens.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Lambda: Snipcart Webhook Handler
# ---------------------------------------------------------------------------

data "archive_file" "webhook_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/webhook"
  output_path = "${path.module}/.build/webhook.zip"
}

resource "aws_lambda_function" "webhook" {
  function_name    = "divine-printing-webhook"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 15
  memory_size      = 256
  filename         = data.archive_file.webhook_zip.output_path
  source_code_hash = data.archive_file.webhook_zip.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE          = aws_dynamodb_table.orders.name
      CUSTOMERS_TABLE       = aws_dynamodb_table.customers.name
      SNIPCART_SECRET_KEY   = var.snipcart_secret_api_key
      NOTIFICATION_EMAIL    = var.ses_sender_email
    }
  }
}

# ---------------------------------------------------------------------------
# Lambda: Send Magic Link
# ---------------------------------------------------------------------------

data "archive_file" "auth_send_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/auth-send-magic-link"
  output_path = "${path.module}/.build/auth-send-magic-link.zip"
}

resource "aws_lambda_function" "auth_send" {
  function_name    = "divine-printing-auth-send"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 256
  filename         = data.archive_file.auth_send_zip.output_path
  source_code_hash = data.archive_file.auth_send_zip.output_base64sha256

  environment {
    variables = {
      CUSTOMERS_TABLE  = aws_dynamodb_table.customers.name
      TOKENS_TABLE     = aws_dynamodb_table.auth_tokens.name
      SES_SENDER_EMAIL = var.ses_sender_email
      MAGIC_LINK_BASE  = var.magic_link_base_url
      MAGIC_LINK_SECRET = var.magic_link_secret
    }
  }
}

# ---------------------------------------------------------------------------
# Lambda: Validate Token
# ---------------------------------------------------------------------------

data "archive_file" "auth_validate_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/auth-validate-token"
  output_path = "${path.module}/.build/auth-validate-token.zip"
}

resource "aws_lambda_function" "auth_validate" {
  function_name    = "divine-printing-auth-validate"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 256
  filename         = data.archive_file.auth_validate_zip.output_path
  source_code_hash = data.archive_file.auth_validate_zip.output_base64sha256

  environment {
    variables = {
      CUSTOMERS_TABLE   = aws_dynamodb_table.customers.name
      TOKENS_TABLE      = aws_dynamodb_table.auth_tokens.name
      MAGIC_LINK_SECRET = var.magic_link_secret
    }
  }
}

# ---------------------------------------------------------------------------
# Lambda: Account API (fetch orders for customer)
# ---------------------------------------------------------------------------

data "archive_file" "account_api_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/account-api"
  output_path = "${path.module}/.build/account-api.zip"
}

resource "aws_lambda_function" "account_api" {
  function_name    = "divine-printing-account-api"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 256
  filename         = data.archive_file.account_api_zip.output_path
  source_code_hash = data.archive_file.account_api_zip.output_base64sha256

  environment {
    variables = {
      ORDERS_TABLE      = aws_dynamodb_table.orders.name
      CUSTOMERS_TABLE   = aws_dynamodb_table.customers.name
      TOKENS_TABLE      = aws_dynamodb_table.auth_tokens.name
      MAGIC_LINK_SECRET = var.magic_link_secret
    }
  }
}

# ---------------------------------------------------------------------------
# API Gateway (HTTP API)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "api" {
  name          = "divine-printing-account-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://www.divineprinting.com", "https://divineprinting.com"]
    allow_methods = ["POST", "GET", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

# --- Webhook integration ---
resource "aws_apigatewayv2_integration" "webhook" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "webhook" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /webhook"
  target    = "integrations/${aws_apigatewayv2_integration.webhook.id}"
}

resource "aws_lambda_permission" "webhook_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# --- Auth: Send magic link ---
resource "aws_apigatewayv2_integration" "auth_send" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth_send.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "auth_send" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /auth/send-magic-link"
  target    = "integrations/${aws_apigatewayv2_integration.auth_send.id}"
}

resource "aws_lambda_permission" "auth_send_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_send.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# --- Auth: Validate token ---
resource "aws_apigatewayv2_integration" "auth_validate" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth_validate.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "auth_validate" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /auth/validate"
  target    = "integrations/${aws_apigatewayv2_integration.auth_validate.id}"
}

resource "aws_lambda_permission" "auth_validate_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_validate.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# --- Account API ---
resource "aws_apigatewayv2_integration" "account_api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.account_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "account_orders" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /account/orders"
  target    = "integrations/${aws_apigatewayv2_integration.account_api.id}"
}

resource "aws_apigatewayv2_route" "account_profile" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /account/profile"
  target    = "integrations/${aws_apigatewayv2_integration.account_api.id}"
}

resource "aws_lambda_permission" "account_api_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.account_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "api_endpoint" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "webhook_url" {
  value = "${aws_apigatewayv2_api.api.api_endpoint}/webhook"
}

output "orders_table_name" {
  value = aws_dynamodb_table.orders.name
}

output "customers_table_name" {
  value = aws_dynamodb_table.customers.name
}

output "auth_tokens_table_name" {
  value = aws_dynamodb_table.auth_tokens.name
}
