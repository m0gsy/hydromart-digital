/**
 * How long a customer has been holding a depot's gallons.
 *
 * The ledger knows HOW MANY are out (issued minus returned) but not how long, so a customer
 * who took two gallons last week and one who took them nine months ago looked identical:
 * both "2 on loan". This is the missing dimension.
 *
 * Returns clear the OLDEST issue first. Gallons are interchangeable — what the customer
 * hands back is not "the gallon from March" — so the fair reading is that the returns settled
 * the oldest debt, and what is still out is the most recent issues. That makes the customer's
 * holding time as short as the ledger allows, which is the right side to err on when the
 * result is a reminder sent to a real person.
 *
 * Pure: the caller supplies the issues, newest first, and how many gallons are still out
 * (computed from the ledger TOTALS, not from these rows — so a cap on how many rows were
 * fetched can never change how many gallons are out, only how far back the walk can see).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssueRow {
  quantity: number;
  createdAt: Date;
}

export interface GallonAging {
  /** Gallons held for longer than `maxHoldDays`. */
  overdue: number;
  /** When the oldest gallon still out was handed over; null when none is out. */
  oldestIssuedAt: Date | null;
}

export function ageOutstanding(
  issuesNewestFirst: readonly IssueRow[],
  outstanding: number,
  now: Date,
  maxHoldDays: number,
): GallonAging {
  const cutoff = now.getTime() - maxHoldDays * DAY_MS;
  let stillOut = Math.max(0, outstanding);
  let overdue = 0;
  let oldest: Date | null = null;

  for (const issue of issuesNewestFirst) {
    if (stillOut === 0) break;
    const held = Math.min(stillOut, issue.quantity);
    stillOut -= held;
    oldest = issue.createdAt;
    if (issue.createdAt.getTime() < cutoff) overdue += held;
  }

  // The rows ran out before the gallons did: the fetch was capped, so what is left is OLDER
  // than the oldest row seen. It is only counted overdue when that oldest row already is —
  // guessing "very old" would put a customer on a reminder list on the strength of a gap in
  // the data rather than a gap in their behaviour.
  if (stillOut > 0 && oldest !== null && oldest.getTime() < cutoff) overdue += stillOut;

  return { overdue, oldestIssuedAt: oldest };
}
