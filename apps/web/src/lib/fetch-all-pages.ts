import type { Page } from '@/lib/types';

/**
 * K3.5 — read every page of a paginated list, or refuse. Never a silent first page.
 *
 * `{ limit: 100 }` was on six product screens, and the plan's own reasoning is why it is a
 * shared fix rather than six patches: the decisive one is the inventory new-line form. Past
 * 100 active products an operator can no longer SEE an older product there, so they can
 * never open its stock row — and the till derives its catalogue from stock rows, so the
 * product can never be sold. Fixing the till alone could not have delivered the outcome.
 *
 * The shape is taken from `readAllPages` in @hydromart/platform, which exists for the same
 * reason on the server: a page size is the wrong answer when the caller needs the whole
 * list, but an unbounded read is how one request pulls a whole table. So: bounded pages, and
 * a ceiling that THROWS rather than returning part of the answer. A truncated catalogue is
 * not a slower screen, it is a wrong screen that looks right — which is exactly how
 * `{ limit: 100 }` survived this long.
 *
 * `total` from the first page decides how many more to ask for, so a list that fits in one
 * page costs exactly one request — the common case stays as cheap as it was.
 */
export const PAGE_SIZE = 200;

/** Refuses past this. 5,000 products is far beyond any real depot catalogue. */
export const MAX_ITEMS = 5000;

export class TooManyPagesError extends Error {
  /*
   * Deliberately NOT translated, and deliberately not user copy.
   *
   * 5,000 products is far past any real depot catalogue, so a reader who sees this has hit
   * the ceiling — and the answer to that is a search box on the screen that hit it, not an
   * Indonesian sentence telling a cashier to cope. Keeping it technical also keeps the i18n
   * gate honest: it looks for Indonesian copy outside the dictionaries, and it was right to
   * flag the first version of this line, which had some.
   */
  constructor(total: number) {
    super(`Catalogue too large to read in full (${total} rows); add search to this screen.`);
    this.name = 'TooManyPagesError';
  }
}

/**
 * @param fetchPage called with a 1-based page number; must honour `limit`.
 */
export async function fetchAllPages<T>(
  fetchPage: (args: { page: number; limit: number }) => Promise<Page<T>>,
  options: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const limit = options.pageSize ?? PAGE_SIZE;
  const max = options.max ?? MAX_ITEMS;

  const first = await fetchPage({ page: 1, limit });
  const total = first.total ?? first.items.length;
  if (total > max) throw new TooManyPagesError(total);

  const out = [...first.items];
  // `total` is the server's count, so the number of pages is known after one call rather
  // than discovered by asking until a page comes back short — which would cost one extra
  // request every time and, on a list that is an exact multiple of the page size, two.
  const pages = Math.ceil(total / limit);
  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchPage({ page, limit });
    out.push(...next.items);
    // A server that keeps answering with items while claiming a smaller total would loop
    // forever otherwise. Stopping is right; stopping SILENTLY is what this file exists to
    // prevent, so it throws.
    if (out.length > max) throw new TooManyPagesError(out.length);
  }
  return out;
}
