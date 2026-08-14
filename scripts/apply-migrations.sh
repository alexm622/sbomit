#!/usr/bin/env bash
set -euo pipefail

# Apply D1 migrations and regenerate Wrangler types.
# Usage: ./scripts/apply-migrations.sh

DB_NAME="sbomit-deps"

echo "==> Applying local D1 migrations for ${DB_NAME}"
npx wrangler d1 migrations apply "${DB_NAME}" --local

echo ""
read -r -p "Apply remote D1 migrations? (y/N) " -n 1 reply
echo ""
if [[ "${reply}" =~ ^[Yy]$ ]]; then
  echo "==> Applying remote D1 migrations for ${DB_NAME}"
  npx wrangler d1 migrations apply "${DB_NAME}" --remote
fi

echo ""
echo "==> Regenerating Wrangler types"
npx wrangler types

echo ""
echo "Done."
