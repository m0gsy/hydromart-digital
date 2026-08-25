/**
 * K1.6 — how long Hydromart has to answer a data-subject request.
 *
 * The screen already said the right things about WHAT happens: head office reviews every
 * request, and a deletion permanently removes the account while payment history is kept
 * without an identity because tax law requires it. What it never said was WHEN — and that
 * is the half that is a legal commitment rather than an explanation.
 *
 * 3×24 hours is the figure in UU PDP No. 27/2022. It is written here once, in hours, and
 * read by both screens that care: the customer's own request list and the head-office
 * queue that reviews them. A promise printed on one screen and measured on neither is the
 * kind of number this codebase keeps finding.
 *
 * What this deliberately does NOT do is alert anybody. The queue is the screen the
 * reviewer already opens, and a row that says OVERDUE there is a person-facing signal. An
 * ops notification would be its own decision about who gets woken and when.
 */
export const PDP_SLA_HOURS = 72;

/** When a request made at `requestedAt` must be answered by. */
export function pdpDeadline(requestedAt: string | Date): Date {
  const from = requestedAt instanceof Date ? requestedAt : new Date(requestedAt);
  return new Date(from.getTime() + PDP_SLA_HOURS * 60 * 60 * 1000);
}

/**
 * Is this request past its deadline and still unanswered?
 *
 * `status` matters: a request that was decided is not overdue however long ago it was
 * made, and marking finished work red is how a queue teaches people to ignore red.
 */
export function pdpOverdue(
  requestedAt: string | Date,
  status: string,
  now: Date = new Date(),
): boolean {
  if (status !== 'PENDING') return false;
  return now.getTime() > pdpDeadline(requestedAt).getTime();
}
