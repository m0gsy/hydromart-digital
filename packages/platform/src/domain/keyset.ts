/**
 * Cursor pagination, offered ALONGSIDE page numbers (audit Q-16).
 *
 * `skip: (page - 1) * limit` makes Postgres walk and discard every row before the page it
 * was asked for, so page 500 costs 500 pages of work. Bounding the page number caps that
 * cost but does not remove it — a keyset walk does, because the database seeks straight to
 * the cursor row.
 *
 * The page-number path is untouched: a caller that sends no cursor gets exactly what it
 * always got. Callers that page deep — sweeps, exports, feeds, infinite scroll — send the
 * cursor from the previous response instead.
 *
 * Two rules for the query that uses this:
 *  - order by something stable and END with `id`, or two rows sharing a timestamp can be
 *    returned twice or skipped;
 *  - `nextCursor` is the id of the last row, and null once a page comes back short.
 */
export interface KeysetQuery {
  page: number;
  limit: number;
  /** Opaque — the `nextCursor` of the previous response (the last row's id). */
  cursor?: string;
}

export interface KeysetArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
}

/** Prisma paging args for either style, from one query object. */
export function pageArgs(query: KeysetQuery): KeysetArgs {
  if (query.cursor) return { take: query.limit, cursor: { id: query.cursor }, skip: 1 };
  return { take: query.limit, skip: (query.page - 1) * query.limit };
}

/**
 * The cursor to hand back, or null when this page is the last one. A full page is not proof
 * that more exist — it is the only cheap signal, and one extra empty request is a better
 * trade than counting the whole table.
 */
export function nextCursor<T extends { id: string }>(rows: T[], limit: number): string | null {
  return rows.length === limit && limit > 0 ? (rows[rows.length - 1]?.id ?? null) : null;
}
