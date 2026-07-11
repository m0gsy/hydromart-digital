import { resolveRoute } from '../../src/routing/route-table';

const UPSTREAMS: Record<string, string> = {
  auth: 'http://localhost:3001',
  customers: 'http://localhost:3002',
  products: 'http://localhost:3003',
  orders: 'http://localhost:3004',
  payments: 'http://localhost:3005',
  deliveries: 'http://localhost:3006',
  depots: 'http://localhost:3007',
  dashboard: 'http://localhost:3008',
  recommendations: 'http://localhost:3013',
};

describe('resolveRoute', () => {
  it.each(Object.entries(UPSTREAMS))(
    'routes /%s/... to its upstream',
    (segment, target) => {
      expect(resolveRoute(`/${segment}/api/v1/things`, UPSTREAMS)).toEqual({ target, segment });
    },
  );

  it('resolves off the first segment only', () => {
    expect(resolveRoute('/orders/api/v1/orders', UPSTREAMS)).toEqual({
      target: 'http://localhost:3004',
      segment: 'orders',
    });
  });

  it('returns null for an unknown first segment', () => {
    expect(resolveRoute('/nonsense/foo', UPSTREAMS)).toBeNull();
  });

  it('returns null for the root path', () => {
    expect(resolveRoute('/', UPSTREAMS)).toBeNull();
    expect(resolveRoute('', UPSTREAMS)).toBeNull();
  });
});
