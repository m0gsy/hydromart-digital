import { nextCursor, pageArgs } from './keyset';

describe('pageArgs', () => {
  it('pages by offset when no cursor is given — the contract every client has today', () => {
    expect(pageArgs({ page: 1, limit: 20 })).toEqual({ take: 20, skip: 0 });
    expect(pageArgs({ page: 3, limit: 20 })).toEqual({ take: 20, skip: 40 });
  });

  it('seeks to the cursor row and steps past it', () => {
    expect(pageArgs({ page: 1, limit: 20, cursor: 'row-9' })).toEqual({
      take: 20,
      cursor: { id: 'row-9' },
      skip: 1,
    });
  });

  it('ignores the page number entirely once a cursor is present', () => {
    // Otherwise a client that keeps sending page=1 alongside its cursor would re-read the
    // same rows, and one that increments both would skip a page of them.
    expect(pageArgs({ page: 7, limit: 5, cursor: 'row-9' })).toEqual({
      take: 5,
      cursor: { id: 'row-9' },
      skip: 1,
    });
  });
});

describe('nextCursor', () => {
  it('hands back the last row of a full page', () => {
    expect(nextCursor([{ id: 'a' }, { id: 'b' }], 2)).toBe('b');
  });

  it('is null once the page comes back short — that is the end of the list', () => {
    expect(nextCursor([{ id: 'a' }], 2)).toBeNull();
    expect(nextCursor([], 2)).toBeNull();
  });

  it('is null for a zero limit rather than reading past the end of an empty page', () => {
    expect(nextCursor([], 0)).toBeNull();
  });
});
