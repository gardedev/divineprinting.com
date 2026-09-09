#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
source_root="$repository_root/infrastructure/server"
output_root="${1:-$repository_root/dist/checkout}"
build_root="$(mktemp -d)"
stage_root="$build_root/package"
trap 'rm -rf "$build_root"' EXIT

mkdir -p "$stage_root" "$output_root"
(
  cd "$source_root"
  find . -type f \
    ! -path './node_modules/*' \
    ! -path '*/__tests__/*' \
    ! -name '*.test.js' \
    -print0 | LC_ALL=C sort -z | tar --null -T - -cf -
) | (cd "$stage_root" && tar -xf -)

npm ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix "$stage_root"
find "$stage_root/node_modules" -type d \( -name test -o -name tests -o -name __tests__ \) -prune -exec rm -rf {} +
find "$stage_root/node_modules" -type f \( -name '*.test.js' -o -name '*.spec.js' \) -delete
find "$stage_root" -exec touch -h -d '@315532800' {} +

temporary_zip="$build_root/divine-printing-checkout-api.zip"
(
  cd "$stage_root"
  find . -type f -print | LC_ALL=C sort | zip -X -q "$temporary_zip" -@
)

artifact_sha256="$(sha256sum "$temporary_zip" | cut -d' ' -f1)"
artifact_name="divine-printing-checkout-api-sha256-${artifact_sha256}.zip"
cp "$temporary_zip" "$output_root/$artifact_name"

printf 'ARTIFACT_PATH=%s\n' "$output_root/$artifact_name"
printf 'ARTIFACT_SHA256=%s\n' "$artifact_sha256"
printf 'S3_OBJECT_KEY=divineprinting/task-6.4/checkout/sha256-%s/divine-printing-checkout-api.zip\n' "$artifact_sha256"
