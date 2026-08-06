import { buildPage } from '../../src/application/pagination';

describe('buildPage', () => {
  it('reports the page envelope every client already reads', () => {
    expect(buildPage([1, 2], 5, 1, 2)).toEqual({
      items: [1, 2],
      total: 5,
      page: 1,
      limit: 2,
      totalPages: 3,
      nextCursor: null,
    });
  });

  it('carries a keyset cursor when the repository found one (audit Q-16)', () => {
    expect(buildPage([1], 5, 1, 1, 'ord-9').nextCursor).toBe('ord-9');
  });

  it('never reports zero pages, so an empty list still renders as page 1 of 1', () => {
    expect(buildPage([], 0, 1, 20).totalPages).toBe(1);
  });
});
