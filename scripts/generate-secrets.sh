#!/usr/bin/env bash
# Generate strong random values for every production secret, ready to paste into
# the prod .env. The boot-time env validation (packages/platform requiredSecret)
# rejects any value still containing "change-me" when NODE_ENV=production, so run
# this before the first prod deploy and replace the placeholders it prints.
#
#   bash scripts/generate-secrets.sh
#
# Each value is high-entropy base64url. Store the output in your secret manager;
# never commit a filled-in .env.
set -euo pipefail

gen() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }

cat <<EOF
# ---- Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — copy into the prod .env ----
JWT_ACCESS_SECRET=$(gen 48)
JWT_REFRESH_SECRET=$(gen 48)
OTP_PEPPER=$(gen 32)
PAYMENT_WEBHOOK_SECRET=$(gen 32)
# One shared internal key — must be IDENTICAL in every service that talks internally.
INTERNAL_SERVICE_KEY=$(gen 32)
EOF
