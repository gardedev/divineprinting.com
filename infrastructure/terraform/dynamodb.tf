# DynamoDB tables for Divine Printing custom account system

resource "aws_dynamodb_table" "customers" {
  name         = "divine-printing-customers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  attribute {
    name = "customerId"
    type = "S"
  }

  global_secondary_index {
    name            = "customerId-index"
    hash_key        = "customerId"
    projection_type = "ALL"
  }

  tags = {
    Name        = "divine-printing-customers"
    Environment = "production"
  }
}

resource "aws_dynamodb_table" "orders" {
  name         = "divine-printing-orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"
  range_key    = "orderId"

  attribute {
    name = "email"
    type = "S"
  }

  attribute {
    name = "orderId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "createdAt-index"
    hash_key        = "email"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  tags = {
    Name        = "divine-printing-orders"
    Environment = "production"
  }
}

output "customers_table_name" {
  value = aws_dynamodb_table.customers.name
}

output "orders_table_name" {
  value = aws_dynamodb_table.orders.name
}
