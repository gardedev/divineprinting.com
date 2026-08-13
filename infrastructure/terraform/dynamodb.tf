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

# Shopping cart desired state (ADR 0004). These tables intentionally keep
# cart lifecycle/ownership separate from line items.
resource "aws_dynamodb_table" "carts" {
  name         = "divine-printing-carts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cartId"

  attribute {
    name = "cartId"
    type = "S"
  }

  attribute {
    name = "customerId"
    type = "S"
  }

  attribute {
    name = "anonymousSessionHash"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "updatedAt"
    type = "S"
  }

  attribute {
    name = "expiresAt"
    type = "N"
  }

  global_secondary_index {
    name            = "CustomerActiveCartIndex"
    hash_key        = "customerId"
    range_key       = "updatedAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "AnonymousSessionIndex"
    hash_key        = "anonymousSessionHash"
    range_key       = "updatedAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "CartStatusExpiryIndex"
    hash_key        = "status"
    range_key       = "expiresAt"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = {
    Name        = "divine-printing-carts"
    Environment = "production"
  }
}

resource "aws_dynamodb_table" "cart_items" {
  name         = "divine-printing-cart-items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cartId"
  range_key    = "cartItemId"

  attribute {
    name = "cartId"
    type = "S"
  }

  attribute {
    name = "cartItemId"
    type = "S"
  }

  attribute {
    name = "productId"
    type = "S"
  }

  attribute {
    name = "updatedAt"
    type = "S"
  }

  global_secondary_index {
    name            = "ProductCartItemIndex"
    hash_key        = "productId"
    range_key       = "updatedAt"
    projection_type = "ALL"
  }

  tags = {
    Name        = "divine-printing-cart-items"
    Environment = "production"
  }
}

output "customers_table_name" {
  value = aws_dynamodb_table.customers.name
}

output "orders_table_name" {
  value = aws_dynamodb_table.orders.name
}

output "carts_table_name" {
  value = aws_dynamodb_table.carts.name
}

output "cart_items_table_name" {
  value = aws_dynamodb_table.cart_items.name
}
