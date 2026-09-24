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

/*
 * CORE-6 — the cursor is documented "Opaque" and was a bare row id.
 *
 * Two things follow from that. A caller can type any id it has seen anywhere and page from
 * it (the query's own WHERE still scopes what comes back, so this is a leak of shape rather
 * than of rows), and the value advertises the table's primary key to everyone who reads a
 * URL — including whoever writes the next client against it and then depends on it being an
 * id forever.
 *
 * Encoded with a checksum, so a hand-typed id is refused and a truncated one is caught. It
 * is NOT authenticated — there is no per-service secret in this package, and pretending
 * otherwise would be worse than the current honesty. What stops a caller paging through
 * somebody else's rows is the WHERE clause, exactly as before.
 */
const CURSOR_VERSION = 'k1';

function checksum(value: string): string {
  // FNV-1a, four hex chars: enough to catch a typo or a truncation, no more than that.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 16).toString(16).padStart(4, '0');
}

/** Wrap a row id as the opaque cursor the API hands back. */
export function encodeCursor(id: string): string {
  const body = Buffer.from(id, 'utf8').toString('base64url');
  return `${CURSOR_VERSION}.${body}.${checksum(body)}`;
}

/** The row id inside a cursor, or null when it was not one we wrote. */
export function decodeCursor(cursor: string): string | null {
  const [version, body, sum] = cursor.split('.');
  if (version !== CURSOR_VERSION || !body || !sum) return null;
  if (checksum(body) !== sum) return null;
  const id = Buffer.from(body, 'base64url').toString('utf8');
  return id.length > 0 ? id : null;
}

export interface KeysetArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
}

/**
 * Prisma paging args for either style, from one query object.
 *
 * CORE-6: a cursor that does not decode is ignored rather than passed to Prisma as an id.
 * Handing `cursor: { id: 'whatever-they-typed' }` to the database raises P2025 from deep
 * inside the repository, which surfaces as a 500 for what is a malformed request.
 */
export function pageArgs(query: KeysetQuery): KeysetArgs {
  const id = query.cursor ? decodeCursor(query.cursor) : null;
  if (id) return { take: query.limit, cursor: { id }, skip: 1 };
  return { take: query.limit, skip: (query.page - 1) * query.limit };
}

/**
 * The cursor to hand back, or null when this page is the last one. A full page is not proof
 * that more exist — it is the only cheap signal, and one extra empty request is a better
 * trade than counting the whole table.
 */
export function nextCursor<T extends { id: string }>(rows: T[], limit: number): string | null {
  const last = rows.length === limit && limit > 0 ? rows[rows.length - 1]?.id : undefined;
  return last ? encodeCursor(last) : null;
}
