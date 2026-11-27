/**
 * Read a uuid-cursor list to the end, or to a ceiling and say so. Same contract as
 * `fetch-all-pages.ts` (limit 100 = the DTO's @Max) except that a map would rather show 3000
 * dots and a banner than refuse, so the ceiling returns `truncated: true` instead of throwing.
 */
export const CURSOR_PAGE_SIZE = 100;
export const CURSOR_CEILING = 3000;

export async function fetchAllCursor<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  ceiling = CURSOR_CEILING,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (!page.nextCursor) return { items, truncated: false };
    if (items.length >= ceiling) return { items: items.slice(0, ceiling), truncated: true };
    cursor = page.nextCursor;
  }
}
