import { localDayKey } from '@hydromart/platform';

import { PendingQueueAnswer } from '../application/ports/pending-approvals.port';

/**
 * AI-9: who gets the morning summary. Owner default 24 Nov 2026: the Direksi. One place to
 * change it; every role named here must be network-wide (dashboard-service refuses to answer
 * for a depot-scoped role, whose empty depot list would read as "nothing waiting").
 */
export const MORNING_SUMMARY_ROLES: readonly string[] = ['DIREKTUR'];

/** Short names for the HD-11 queues, as the summary says them. An unknown key is said as it came. */
const QUEUE_LABEL: Record<string, string> = {
  priceOverrides: 'Usulan harga',
  refunds: 'Refund',
  expenses: 'Klaim biaya',
  settlements: 'Setoran kurir',
  leave: 'Cuti',
  kasbon: 'Kasbon',
  franchiseApplications: 'Lamaran waralaba',
  approvals: 'Persetujuan depot',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const WIB_OFFSET_MS = 7 * 3_600_000;

/** The date in the business zone (Asia/Jakarta), as YYYY-MM-DD. */
export const wibDate = (at: Date): string => localDayKey(at);

function wibDayMonth(iso: string): string {
  const d = new Date(new Date(iso).getTime() + WIB_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export interface MorningSummaryText {
  /** Queue labels with their counts: "Usulan harga 2, Cuti 1, Refund belum terbaca". */
  summary: string;
  /** " Tertua sejak 12 Nov." or empty. */
  oldest: string;
  /** The queue with the most waiting: where the tap goes. */
  href: string;
}

/**
 * What one person's queues say, or null when nothing waits for them (no row, no push, no email:
 * no noise). A queue that could not be read is said as such, never as 0, and is not "nothing".
 * THROWS when nothing readable waits and some queue could not be read: there is nothing real to
 * say yet, and filing "X belum terbaca" would dedupe away the complete summary on the retry.
 */
export function summaryOf(queues: readonly PendingQueueAnswer[]): MorningSummaryText | null {
  const waiting = queues.filter((q) => q.error === undefined && Number(q.count) > 0);
  const unreadable = queues.filter((q) => q.error !== undefined);
  if (waiting.length === 0) {
    if (unreadable.length === 0) return null;
    throw new Error('no queue could be read for this recipient');
  }
  const label = (q: PendingQueueAnswer) => QUEUE_LABEL[q.key] ?? q.key;
  const summary = [
    ...waiting.map((q) => `${label(q)} ${q.count}`),
    ...unreadable.map((q) => `${label(q)} belum terbaca`),
  ].join(', ');
  const since = waiting
    .map((q) => q.oldestAt)
    .filter((t): t is string => t !== null)
    .sort()[0];
  const biggest = waiting.reduce<PendingQueueAnswer | null>(
    (best, q) => (best === null || Number(q.count) > Number(best.count) ? q : best),
    null,
  );
  return {
    summary,
    oldest: since ? ` Tertua sejak ${wibDayMonth(since)}.` : '',
    href: biggest!.href,
  };
}
