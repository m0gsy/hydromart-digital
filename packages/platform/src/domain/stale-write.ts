import { DomainError, HTTP_STATUS } from './domain-error';

/**
 * CA-2-53 — two people edit the same record, and the second save silently erases the
 * first.
 *
 * Every console form in this app reads a record, holds it in local state while somebody
 * types, and PUTs the whole thing back. Nothing in that round trip says which version was
 * read, so the server cannot tell an edit from an overwrite. Two HQ admins on the same
 * policy page produce whatever the slower one happened to be looking at, and neither of
 * them is told.
 *
 * The fix is the smallest one that can work: the client sends back the `updatedAt` it was
 * shown, and the write is refused if the stored row has moved since. No new column, no
 * version counter — the timestamp the record already carries IS the version.
 */
export class StaleWriteError extends DomainError {
  readonly code = 'STALE_WRITE';
  readonly status = HTTP_STATUS.CONFLICT;

  constructor(message = 'Data ini sudah diubah orang lain sejak Anda membukanya.') {
    super(message);
  }
}

/**
 * Refuse a write whose author last read an older version of the record.
 *
 * Fails CLOSED on a missing token, and that is the whole point: a client that does not
 * say what it saw is exactly the client that overwrites blindly. The one case that is
 * allowed through is a record that does not exist yet — there is nothing to lose.
 *
 * THE LIMIT, said plainly: the timestamp has millisecond resolution, so two writes landing
 * inside the same millisecond would look like the same version. That is a real hole and it
 * is not closed here — closing it means a version counter, which is a column and a
 * migration per table. For a person typing into a settings form it does not arise; for a
 * machine writing in a loop it would, and such a caller needs the counter.
 *
 * @param stored the `updatedAt` of the row as it is NOW, or null when there is no row
 * @param seen   the `updatedAt` the caller was shown, as an ISO string
 */
export function assertFresh(stored: Date | null | undefined, seen: string | null | undefined): void {
  if (!stored) return;
  if (!seen) throw new StaleWriteError();
  const seenMs = Date.parse(seen);
  // An unparseable stamp is not a match, and treating it as one would make the guard
  // optional for anyone who sends junk.
  if (Number.isNaN(seenMs) || seenMs !== stored.getTime()) throw new StaleWriteError();
}
