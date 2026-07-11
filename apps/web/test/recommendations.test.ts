import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';

describe('endpoints.recommendations', () => {
  it('builds the reorder path, omitting an unset limit', () => {
    expect(endpoints.recommendations.reorder()).toBe(
      '/recommendations/api/v1/recommendations/reorder',
    );
    expect(endpoints.recommendations.reorder(5)).toBe(
      '/recommendations/api/v1/recommendations/reorder?limit=5',
    );
  });

  it('builds the related path for a product, omitting an unset limit', () => {
    expect(endpoints.recommendations.related('p1')).toBe(
      '/recommendations/api/v1/recommendations/products/p1/related',
    );
    expect(endpoints.recommendations.related('p1', 4)).toBe(
      '/recommendations/api/v1/recommendations/products/p1/related?limit=4',
    );
  });

  it('builds the trending path, omitting unset depotId/days/limit', () => {
    expect(endpoints.recommendations.trending()).toBe(
      '/recommendations/api/v1/recommendations/trending',
    );
    expect(endpoints.recommendations.trending({ depotId: 'd1', days: 14, limit: 8 })).toBe(
      '/recommendations/api/v1/recommendations/trending?depotId=d1&days=14&limit=8',
    );
    expect(endpoints.recommendations.trending({ depotId: 'd1' })).toBe(
      '/recommendations/api/v1/recommendations/trending?depotId=d1',
    );
  });
});
