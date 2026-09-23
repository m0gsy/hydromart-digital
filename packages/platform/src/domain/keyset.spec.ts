import { decodeCursor, encodeCursor, nextCursor, pageArgs } from './keyset';

describe('pageArgs', () => {
  it('pages by offset when no cursor is given — the contract every client has today', () => {
    expect(pageArgs({ page: 1, limit: 20 })).toEqual({ take: 20, skip: 0 });
    expect(pageArgs({ page: 3, limit: 20 })).toEqual({ take: 20, skip: 40 });
  });

  it('seeks to the cursor row and steps past it', () => {
    expect(pageArgs({ page: 1, limit: 20, cursor: encodeCursor('row-9') })).toEqual({
      take: 20,
      cursor: { id: 'row-9' },
      skip: 1,
    });
  });

  /*
   * CORE-6: the cursor is documented "Opaque" and was a bare row id — so a caller could
   * type any id it had seen anywhere and page from it, and a hand-mangled value reached
   * Prisma as an id and raised P2025 from inside the repository (a 500 for a malformed
   * request). A value we did not write is now simply not a cursor.
   */
  it.each([
    ['a raw row id', 'row-9'],
    ['a truncated cursor', encodeCursor('row-9').slice(0, -1)],
    ['a cursor with a rewritten body', `k1.${Buffer.from('row-99').toString('base64url')}.0000`],
    ['nonsense', 'k1..'],
  ])('falls back to page numbers for %s', (_label, cursor) => {
    expect(pageArgs({ page: 3, limit: 20, cursor })).toEqual({ take: 20, skip: 40 });
  });

  it('refuses a cursor whose body decodes to nothing', () => {
    const empty = `k1..${''}`;
    expect(decodeCursor(empty)).toBeNull();
    // A well-formed envelope around an empty id is still not an id.
    const body = Buffer.from('', 'utf8').toString('base64url');
    expect(decodeCursor(`k1.${body}.0000`)).toBeNull();
  });

  it('round-trips an id through the cursor', () => {
    expect(decodeCursor(encodeCursor('row-9'))).toBe('row-9');
    // And the id is not sitting in plain sight in the value handed to the client.
    expect(encodeCursor('row-9')).not.toContain('row-9');
  });

  it('ignores the page number entirely once a cursor is present', () => {
    // Otherwise a client that keeps sending page=1 alongside its cursor would re-read the
    // same rows, and one that increments both would skip a page of them.
    expect(pageArgs({ page: 7, limit: 5, cursor: encodeCursor('row-9') })).toEqual({
      take: 5,
      cursor: { id: 'row-9' },
      skip: 1,
    });
  });
});

describe('nextCursor', () => {
  it('hands back the last row of a full page, as an opaque cursor', () => {
    const cursor = nextCursor([{ id: 'a' }, { id: 'b' }], 2);
    expect(cursor).toBe(encodeCursor('b'));
    expect(decodeCursor(cursor!)).toBe('b');
  });

  it('is null once the page comes back short — that is the end of the list', () => {
    expect(nextCursor([{ id: 'a' }], 2)).toBeNull();
    expect(nextCursor([], 2)).toBeNull();
  });

  it('is null for a zero limit rather than reading past the end of an empty page', () => {
    expect(nextCursor([], 0)).toBeNull();
  });
});
