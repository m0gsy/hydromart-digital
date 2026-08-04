/**
 * Read every row a report needs, in bounded pages, with a ceiling that refuses.
 *
 * Reports are the one place a page size is the wrong answer: a month of sales cut off at
 * row 500 is not a slower report, it is a wrong number that looks right. But an unbounded
 * `findMany` is how a single request pulls a whole table into memory (audit H-44/H-46).
 *
 * So: walk the window by keyset in fixed pages — peak memory is one page, not the result
 * set — and when the total passes `max`, call `onOverflow`, which never returns. Every
 * caller throws its own domain error there, so the API answers "narrow the range" instead
 * of quietly serving part of it.
 *
 * `fetchPage` receives the cursor id of the last row of the previous page (undefined on
 * the first call) and must order deterministically and skip that row.
 */
export async function readAllPages<T extends { id: string }>(
  fetchPage: (args: { take: number; cursor?: string }) => Promise<T[]>,
  options: { max: number; onOverflow: () => never; pageSize?: number },
): Promise<T[]> {
  const pageSize = options.pageSize ?? 500;
  const out: T[] = [];
  let cursor: string | undefined;

  for (;;) {
    const rows = await fetchPage({ take: pageSize, cursor });
    out.push(...rows);
    if (rows.length < pageSize) return out;
    if (out.length >= options.max) options.onOverflow();
    cursor = rows[rows.length - 1].id;
  }
}
