// The set of peer services the aggregate system-health endpoint (Design 13b) probes.
// One entry per Hydromart microservice: `name` is the label shown in the roll-up,
// `envKey` is the env var holding its base URL (mirrors the gateway's SEGMENT_ENV).
// Any env var that is unset is simply omitted from the roll-up (URLs are optional).
export const SERVICE_REGISTRY: readonly { name: string; envKey: string }[] = [
  { name: 'auth-service', envKey: 'AUTH_SERVICE_URL' },
  { name: 'customer-service', envKey: 'CUSTOMER_SERVICE_URL' },
  { name: 'product-service', envKey: 'PRODUCT_SERVICE_URL' },
  { name: 'order-service', envKey: 'ORDER_SERVICE_URL' },
  { name: 'payment-service', envKey: 'PAYMENT_SERVICE_URL' },
  { name: 'delivery-service', envKey: 'DELIVERY_SERVICE_URL' },
  { name: 'depot-service', envKey: 'DEPOT_SERVICE_URL' },
  { name: 'dashboard-service', envKey: 'DASHBOARD_SERVICE_URL' },
  { name: 'loyalty-service', envKey: 'LOYALTY_SERVICE_URL' },
  { name: 'promo-service', envKey: 'PROMO_SERVICE_URL' },
  { name: 'referral-service', envKey: 'REFERRAL_SERVICE_URL' },
  { name: 'crm-service', envKey: 'CRM_SERVICE_URL' },
  { name: 'recommendation-service', envKey: 'RECOMMENDATION_SERVICE_URL' },
  { name: 'forecast-service', envKey: 'FORECAST_SERVICE_URL' },
  { name: 'payout-service', envKey: 'PAYOUT_SERVICE_URL' },
] as const;
