// HD-23: the monthly royalty bill, pure parts. Money maths and dates live here; I/O does not.
import { addLocalMonths, dayStartUtc, localDayKey } from '@hydromart/platform';

export type PartnerBillStatus = 'DRAFT' | 'SENT' | 'VOID';

export interface PartnerBillBasis {
  /** First and last WIB day this line covers (a depot that changed entity mid-month has two lines). */
  from: string;
  to: string;
  /** COMMISSION ledger rows behind the amount, and how many of them are reversals of earlier sales. */
  rows: number;
  reversalRows: number;
  /** What the reversals gave back (positive), already netted into the amount. */
  reversalIdr: number;
}

export interface PartnerBillLineRecord {
  id: string;
  depotId: string;
  label: string;
  amountIdr: number;
  basis: PartnerBillBasis;
}

export interface PartnerBillBank {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

export interface PartnerBillRecord {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  month: string;
  status: PartnerBillStatus;
  totalIdr: number;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  voidReason: string | null;
  bank: PartnerBillBank | null;
  recipientIds: string[];
  lines?: PartnerBillLineRecord[];
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonthKey = (month: string): boolean => MONTH.test(month);

/** The WIB month as a half-open UTC window, plus its first and last day keys. */
export function monthWindow(month: string): { from: Date; to: Date; firstDay: string; lastDay: string } {
  const from = dayStartUtc(`${month}-01`);
  const to = addLocalMonths(from, 1);
  return { from, to, firstDay: `${month}-01`, lastDay: localDayKey(new Date(to.getTime() - 1)) };
}

const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
/** "2026-11" -> "November 2026". */
export const monthLabel = (month: string): string =>
  `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** One stretch of a depot belonging to one entity, as depot-service reports it: from a day, until the next stretch. */
export interface EntitySpan {
  depotId: string;
  legalEntityId: string | null;
  from: string;
}

export interface DepotStretch {
  depotId: string;
  legalEntityId: string | null;
  from: string;
  to: string;
}

/** The day before a day key, in the WIB calendar. */
export function dayBefore(day: string): string {
  return localDayKey(new Date(dayStartUtc(day).getTime() - 1));
}

/** The day after a day key, in the WIB calendar (no daylight saving, so a day is 24 hours). */
export function dayAfter(day: string): string {
  return localDayKey(new Date(dayStartUtc(day).getTime() + 25 * 3_600_000));
}

/** Turns each depot's spans into closed day ranges inside the month: a span runs until the next one starts. */
export function stretchesOf(spans: readonly EntitySpan[], lastDay: string): DepotStretch[] {
  const byDepot = new Map<string, EntitySpan[]>();
  for (const s of spans) byDepot.set(s.depotId, [...(byDepot.get(s.depotId) ?? []), s]);
  return [...byDepot.values()].flatMap((own) => {
    const sorted = [...own].sort((a, b) => a.from.localeCompare(b.from));
    return sorted.map((s, i) => ({
      depotId: s.depotId,
      legalEntityId: s.legalEntityId,
      from: s.from,
      to: i + 1 < sorted.length ? dayBefore(sorted[i + 1].from) : lastDay,
    }));
  });
}

/** " (1 Nov - 14 Nov)" naming the days of a split line; empty when the depot kept one entity all month. */
export function splitNote(stretch: { from: string; to: string }, firstDay: string, lastDay: string): string {
  if (stretch.from === firstDay && stretch.to === lastDay) return '';
  const d = (day: string): string => `${Number(day.slice(8, 10))} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1].slice(0, 3)}`;
  return ` (${d(stretch.from)} - ${d(stretch.to)})`;
}
