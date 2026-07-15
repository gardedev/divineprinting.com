
import boto3
import os
import uuid
import datetime
import argparse
import json
from decimal import Decimal
from botocore.exceptions import ClientError

class ProductManager:
    def __init__(self, table_name="divine-printing-products", region_name="us-east-1"):
        self.dynamodb = boto3.resource("dynamodb", region_name=region_name)
        self.table_name = table_name
        self.table = self.dynamodb.Table(table_name)
        
    def create_product(self, title, description, short_description, base_price, currency, slug, 
                       status="active", product_type="physical", sku=None, tax_category=None,
                       requires_shipping=True, weight=None, dimensions=None, images=None, metadata=None):
        product_id = str(uuid.uuid4())
        timestamp = datetime.datetime.utcnow().isoformat() + "Z" # ISO 8601 format

        item = {
            "productId": product_id,
            "slug": slug,
            "title": title,
            "description": description,
            "shortDescription": short_description,
            "status": status,
            "productType": product_type,
            "basePrice": Decimal(str(base_price)),  # Store as Decimal for DynamoDB precision
            "currency": currency,
            "requiresShipping": requires_shipping,
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "publishedAt": timestamp if status == "active" else None,
        }

        if sku:
            item["sku"] = sku
        if tax_category:
            item["taxCategory"] = tax_category
        if weight:
            item["weight"] = weight
        if dimensions:
            item["dimensions"] = dimensions
        if images:
            item["images"] = images
        if metadata:
            item["metadata"] = metadata
            
        self.table.put_item(Item=item)
        print(f"Product '{title}' (ID: {product_id}) created successfully.")
        return product_id

    def get_product_by_id(self, product_id):
        response = self.table.get_item(Key={"productId": product_id})
        return response.get("Item")
    
    def get_product_by_slug(self, slug):
        response = self.table.query(
            IndexName="slug-index",
            KeyConditionExpression=boto3.dynamodb.conditions.Key("slug").eq(slug)
        )
        items = response.get("Items", [])
        return items[0] if items else None

    # Fields that are permitted to be updated via update_product
    UPDATABLE_FIELDS = {
        "title", "description", "shortDescription", "status", "productType",
        "basePrice", "currency", "slug", "sku", "taxCategory",
        "requiresShipping", "weight", "dimensions", "images", "metadata",
    }

    def update_product(self, product_id, updates):
        # Reject any keys that are not in the whitelist
        disallowed = set(updates.keys()) - self.UPDATABLE_FIELDS
        if disallowed:
            raise ValueError(f"Update contains non-updatable fields: {', '.join(sorted(disallowed))}")

        update_expression = ["SET"]
        expression_attribute_values = {}
        expression_attribute_names = {}

        timestamp = datetime.datetime.utcnow().isoformat() + "Z"
        updates["updatedAt"] = timestamp

        for key, value in updates.items():
            # Dynamically generate placeholder names to avoid reserved keywords
            attr_name_placeholder = f"#{key}"
            attr_value_placeholder = f":{key}"

            update_expression.append(f"{attr_name_placeholder} = {attr_value_placeholder}")
            expression_attribute_values[attr_value_placeholder] = value
            expression_attribute_names[attr_name_placeholder] = key

        try:
            response = self.table.update_item(
                Key={"productId": product_id},
                UpdateExpression=" ".join(update_expression),
                ExpressionAttributeValues=expression_attribute_values,
                ExpressionAttributeNames=expression_attribute_names,
                ReturnValues="UPDATED_NEW"
            )
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            print(f"DynamoDB error updating product '{product_id}': [{error_code}] {error_message}")
            raise
        print(f"Product ID '{product_id}' updated successfully.")
        return response.get("Attributes")

    def list_products(self, limit=10):
        response = self.table.scan(Limit=limit)
        return response.get("Items", [])

    def delete_product(self, product_id):
        self.table.delete_item(Key={"productId": product_id})
        print(f"Product ID '{product_id}' deleted successfully.")

def main():
    parser = argparse.ArgumentParser(description="Manage Divine Printing products in DynamoDB.")
    parser.add_argument("--table-name", default="divine-printing-products", help="DynamoDB table name")
    parser.add_argument("--region", default=os.getenv("AWS_REGION", "us-east-1"), help="AWS region")

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Create command
    create_parser = subparsers.add_parser("create", help="Create a new product")
    create_parser.add_argument("--title", required=True, help="Product title")
    create_parser.add_argument("--description", required=True, help="Product description")
    create_parser.add_argument("--short-description", required=True, help="Product short description")
    create_parser.add_argument("--base-price", type=float, required=True, help="Base price of the product")
    create_parser.add_argument("--currency", default="USD", help="Currency (e.g., USD)")
    create_parser.add_argument("--slug", required=True, help="Unique URL slug for the product")
    create_parser.add_argument("--status", default="active", help="Product status (e.g., active, draft, archived)")
    create_parser.add_argument("--product-type", default="physical", help="Product type (e.g., physical, digital, service)")
    create_parser.add_argument("--sku", help="Stock Keeping Unit")
    create_parser.add_argument("--tax-category", help="Tax category")
    create_parser.add_argument("--requires-shipping", type=bool, default=True, help="Does the product require shipping?")
    create_parser.add_argument("--weight", help="Product weight")
    create_parser.add_argument("--dimensions", help="Product dimensions (JSON string)")
    create_parser.add_argument("--images", help="Product images (JSON string list)")
    create_parser.add_argument("--metadata", help="Product metadata (JSON string)")

    # Get by ID command
    get_id_parser = subparsers.add_parser("get-id", help="Get a product by its ID")
    get_id_parser.add_argument("--product-id", required=True, help="Product ID")

    # Get by Slug command
    get_slug_parser = subparsers.add_parser("get-slug", help="Get a product by its slug")
    get_slug_parser.add_argument("--slug", required=True, help="Product slug")

    # Update command
    update_parser = subparsers.add_parser("update", help="Update an existing product")
    update_parser.add_argument("--product-id", required=True, help="Product ID to update")
    update_parser.add_argument("--title", help="New product title")
    update_parser.add_argument("--description", help="New product description")
    update_parser.add_argument("--short-description", help="New product short description")
    update_parser.add_argument("--base-price", type=float, help="New base price of the product")
    update_parser.add_argument("--currency", help="New currency")
    update_parser.add_argument("--slug", help="New unique URL slug for the product")
    update_parser.add_argument("--status", help="New product status")
    update_parser.add_argument("--product-type", help="New product type")
    update_parser.add_argument("--sku", help="New Stock Keeping Unit")
    update_parser.add_argument("--tax-category", help="New tax category")
    update_parser.add_argument("--requires-shipping", type=bool, help="Does the product require shipping?")
    update_parser.add_argument("--weight", help="New product weight")
    update_parser.add_argument("--dimensions", help="New product dimensions (JSON string)")
    update_parser.add_argument("--images", help="New product images (JSON string list)")
    update_parser.add_argument("--metadata", help="New product metadata (JSON string)")

    # List command
    list_parser = subparsers.add_parser("list", help="List products")
    list_parser.add_argument("--limit", type=int, default=10, help="Number of products to list")

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a product")
    delete_parser.add_argument("--product-id", required=True, help="Product ID to delete")

    args = parser.parse_args()
    
    manager = ProductManager(table_name=args.table_name, region_name=args.region)

    if args.command == "create":
        try:
            dimensions = json.loads(args.dimensions) if args.dimensions else None
        except json.JSONDecodeError as e:
            print(f"Error: --dimensions is not valid JSON: {e}")
            raise SystemExit(1)
        try:
            images = json.loads(args.images) if args.images else None
        except json.JSONDecodeError as e:
            print(f"Error: --images is not valid JSON: {e}")
            raise SystemExit(1)
        try:
            metadata = json.loads(args.metadata) if args.metadata else None
        except json.JSONDecodeError as e:
            print(f"Error: --metadata is not valid JSON: {e}")
            raise SystemExit(1)
        manager.create_product(
            title=args.title,
            description=args.description,
            short_description=args.short_description,
            base_price=args.base_price,
            currency=args.currency,
            slug=args.slug,
            status=args.status,
            product_type=args.product_type,
            sku=args.sku,
            tax_category=args.tax_category,
            requires_shipping=args.requires_shipping,
            weight=args.weight,
            dimensions=dimensions,
            images=images,
            metadata=metadata
        )
    elif args.command == "get-id":
        product = manager.get_product_by_id(args.product_id)
        if product:
            print(json.dumps(product, indent=2))
        else:
            print(f"Product with ID '{args.product_id}' not found.")
    elif args.command == "get-slug":
        product = manager.get_product_by_slug(args.slug)
        if product:
            print(json.dumps(product, indent=2))
        else:
            print(f"Product with slug '{args.slug}' not found.")
    elif args.command == "update":
        # Remap argparse snake_case keys to the camelCase field names used in DynamoDB
        _SNAKE_TO_CAMEL = {
            "short_description": "shortDescription",
            "product_type": "productType",
            "tax_category": "taxCategory",
            "requires_shipping": "requiresShipping",
            "base_price": "basePrice",
        }
        raw_updates = {k: v for k, v in vars(args).items() if v is not None and k not in ["command", "product_id", "table_name", "region"]}
        updates = {_SNAKE_TO_CAMEL.get(k, k): v for k, v in raw_updates.items()}
        if "dimensions" in updates:
            try:
                updates["dimensions"] = json.loads(updates["dimensions"])
            except json.JSONDecodeError as e:
                print(f"Error: --dimensions is not valid JSON: {e}")
                raise SystemExit(1)
        if "images" in updates:
            try:
                updates["images"] = json.loads(updates["images"])
            except json.JSONDecodeError as e:
                print(f"Error: --images is not valid JSON: {e}")
                raise SystemExit(1)
        if "metadata" in updates:
            try:
                updates["metadata"] = json.loads(updates["metadata"])
            except json.JSONDecodeError as e:
                print(f"Error: --metadata is not valid JSON: {e}")
                raise SystemExit(1)
        if "basePrice" in updates:
            updates["basePrice"] = Decimal(str(updates["basePrice"]))
        manager.update_product(args.product_id, updates)
    elif args.command == "list":
        products = manager.list_products(args.limit)
        if products:
            print(json.dumps(products, indent=2))
        else:
            print("No products found.")
    elif args.command == "delete":
        manager.delete_product(args.product_id)

if __name__ == "__main__":
    main()
