import { describe, expect, it } from 'vitest';

import { fetchAllCursor } from '@/lib/fetch-all-cursor';

describe('fetchAllCursor', () => {
  it('follows the cursor to the end', async () => {
    const pages = [
      { items: [1, 2], nextCursor: 'a' },
      { items: [3], nextCursor: null },
    ];
    const seen: (string | undefined)[] = [];
    const out = await fetchAllCursor(async (c) => {
      seen.push(c);
      return pages[seen.length - 1] as (typeof pages)[number];
    });
    expect(out).toEqual({ items: [1, 2, 3], truncated: false });
    expect(seen).toEqual([undefined, 'a']);
  });

  it('stops at the ceiling and says it was cut', async () => {
    const out = await fetchAllCursor(async () => ({ items: [1, 2, 3], nextCursor: 'more' }), 5);
    expect(out.truncated).toBe(true);
    expect(out.items).toHaveLength(5);
  });
});
