#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_dir="${repo_root}/infrastructure/server"
output_dir="${repo_root}/infrastructure/.build"
staging_dir="$(mktemp -d)"
trap 'rm -rf "${staging_dir}"' EXIT

mkdir -p "${output_dir}" "${staging_dir}/server" \
  "${staging_dir}/server/api" "${staging_dir}/server/carts" \
  "${staging_dir}/server/middleware" "${staging_dir}/server/products" \
  "${staging_dir}/server/utils"
cp "${server_dir}/package.json" "${server_dir}/package-lock.json" "${server_dir}/lambda-cart.js" "${staging_dir}/server/"
cp "${server_dir}/api/cartApi.js" "${staging_dir}/server/api/"
cp "${server_dir}/carts/cartRepository.js" "${server_dir}/carts/cartService.js" "${staging_dir}/server/carts/"
cp "${server_dir}/middleware/authorization.js" "${server_dir}/middleware/jwtAuth.js" "${staging_dir}/server/middleware/"
cp "${server_dir}/products/configuredProduct.js" "${server_dir}/products/productRepository.js" \
  "${server_dir}/products/productService.js" "${server_dir}/products/standardConfiguredProduct.js" "${staging_dir}/server/products/"
cp "${server_dir}/utils/dynamoDbClient.js" "${server_dir}/utils/logger.js" "${staging_dir}/server/utils/"
npm ci --omit=dev --ignore-scripts --prefix "${staging_dir}/server"
node -e "require(process.argv[1])" "${staging_dir}/server/lambda-cart.js"
rm -f "${output_dir}/divine-printing-cart-api.zip"

(
  cd "${staging_dir}/server"
  zip -q -r "${output_dir}/divine-printing-cart-api.zip" . \
    -x '*__tests__*' '*.test.js' 'package-lock.json'
)

sha256sum "${output_dir}/divine-printing-cart-api.zip"
