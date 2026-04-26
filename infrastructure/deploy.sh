#!/usr/bin/env bash
set -euo pipefail

# Divine Printing — Infrastructure Deploy Script
# Installs Lambda dependencies and runs Terraform apply

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Installing Lambda dependencies ==="
for dir in "$SCRIPT_DIR"/lambda/*/; do
  if [ -f "$dir/package.json" ]; then
    echo "  → $(basename "$dir")"
    (cd "$dir" && npm install --production --silent)
  fi
done

echo ""
echo "=== Running Terraform ==="
cd "$SCRIPT_DIR/terraform"

if [ ! -f ".terraform/terraform.tfstate" ]; then
  echo "  → terraform init"
  terraform init
fi

echo "  → terraform plan"
terraform plan -out=tfplan

echo ""
echo "Review the plan above. To apply:"
echo "  cd $SCRIPT_DIR/terraform && terraform apply tfplan"
echo ""
echo "After apply, update the API_BASE_URL in:"
echo "  - account/account.html"
echo "  - account/orders.html"
echo "  with the 'api_endpoint' output value."
