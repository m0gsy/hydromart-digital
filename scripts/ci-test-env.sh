#!/usr/bin/env bash
# M4/M5. The one place the unit-gate environment is written down.
#
# `verify` used to be a single job carrying this block inline. Splitting it into `gate`,
# `test` (a matrix) and `visual` would have meant three copies of twenty-three key/value
# pairs that must stay identical — and a block that must stay in sync in three places is
# how every drift in this repo has started. One file, three call sites:
#
#   - name: Unit-gate env
#     run: bash scripts/ci-test-env.sh >> "$GITHUB_ENV"
#
# These are dummy-but-VALID values, not secrets. The specs call
# ConfigModule.forRoot({ validationSchema }), and Joi validates process.env even when the
# spec's own `load` block feeds the app — so a missing key is a boot failure in a test that
# has nothing to do with configuration.
#
# Deliberately NOT at workflow scope, which is the trap and the reason this file exists at
# all: the `integration` job's flow.mjs signs test JWTs and must use ITS OWN defaults,
# matching docker-compose.test.yml. Leak JWT_ACCESS_SECRET down to it from workflow scope
# and every authenticated request in the integration run is signed with a key the booted
# stack does not trust.
set -euo pipefail

cat <<'ENV'
JWT_ACCESS_SECRET=ci-jwt-access-secret-that-is-long-enough-0123456789
JWT_REFRESH_SECRET=ci-jwt-refresh-secret-that-is-long-enough-0123456789
OTP_PEPPER=ci-otp-pepper-value
PAYMENT_WEBHOOK_SECRET=ci-payment-webhook-secret-16plus
WHATSAPP_API_BASE_URL=https://wa.example.com
WHATSAPP_API_TOKEN=ci-whatsapp-token
SMS_API_BASE_URL=https://sms.example.com
SMS_API_TOKEN=ci-sms-token
AUTH_SERVICE_URL=https://auth.example.com
CUSTOMER_SERVICE_URL=https://customer.example.com
PRODUCT_SERVICE_URL=https://product.example.com
ORDER_SERVICE_URL=https://order.example.com
PAYMENT_SERVICE_URL=https://payment.example.com
DELIVERY_SERVICE_URL=https://delivery.example.com
DEPOT_SERVICE_URL=https://depot.example.com
LOYALTY_SERVICE_URL=https://loyalty.example.com
PROMO_SERVICE_URL=https://promo.example.com
REFERRAL_SERVICE_URL=https://referral.example.com
CRM_SERVICE_URL=https://crm.example.com
RECOMMENDATION_SERVICE_URL=https://recommendation.example.com
FORECAST_SERVICE_URL=https://forecast.example.com
DASHBOARD_SERVICE_URL=https://dashboard.example.com
HR_SERVICE_URL=https://hr.example.com
ENV
