// Public path builders. The gateway strips the first segment and forwards the
// rest to the owning service, so every path is `/{segment}/api/v1/...`.

export const endpoints = {
  auth: {
    register: '/auth/api/v1/auth/register',
    verifyOtp: '/auth/api/v1/auth/otp/verify',
    resendOtp: '/auth/api/v1/auth/otp/resend',
    login: '/auth/api/v1/auth/login',
    refresh: '/auth/api/v1/auth/token/refresh',
    me: '/auth/api/v1/auth/me',
    logout: '/auth/api/v1/auth/logout',
  },
  products: {
    browse: (q: { page?: number; limit?: number; search?: string }) => {
      const p = new URLSearchParams();
      if (q.page) p.set('page', String(q.page));
      if (q.limit) p.set('limit', String(q.limit));
      if (q.search) p.set('search', q.search);
      const qs = p.toString();
      return `/products/api/v1/products${qs ? `?${qs}` : ''}`;
    },
    get: (id: string) => `/products/api/v1/products/${id}`,
  },
  cart: {
    view: '/orders/api/v1/cart',
    items: '/orders/api/v1/cart/items',
    item: (productId: string) => `/orders/api/v1/cart/items/${productId}`,
    clear: '/orders/api/v1/cart',
  },
  orders: {
    checkout: '/orders/api/v1/orders/checkout',
    list: '/orders/api/v1/orders',
    get: (id: string) => `/orders/api/v1/orders/${id}`,
    cancel: (id: string) => `/orders/api/v1/orders/${id}/cancel`,
    repeat: (id: string) => `/orders/api/v1/orders/${id}/repeat`,
  },
  payments: {
    initiate: '/payments/api/v1/payments',
    forOrder: (orderId: string) => `/payments/api/v1/payments?orderId=${orderId}`,
  },
} as const;
