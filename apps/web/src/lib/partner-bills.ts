// HD-23 — what payout-service answers on /partner-bills (mirrors PartnerBillResponseDto).

export type PartnerBillStatus = 'DRAFT' | 'SENDING' | 'SENT' | 'VOID';

export const STATUS_TONE: Record<PartnerBillStatus, 'neutral' | 'success' | 'warning'> = {
  DRAFT: 'warning',
  SENDING: 'warning',
  SENT: 'success',
  VOID: 'neutral',
};

export interface PartnerBillLine {
  id: string;
  depotId: string;
  label: string;
  amountIdr: number;
  basis: { from: string; to: string; rows: number; reversalRows: number; reversalIdr: number; ownerIds?: string[] };
}

export interface PartnerBillBank {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

export interface PartnerBill {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  /** `YYYY-MM`, in the business time zone. */
  month: string;
  status: PartnerBillStatus;
  totalIdr: number;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
  voidReason: string | null;
  bank: PartnerBillBank | null;
  recipients: number;
  /** HD-25: WIB day it falls due, and the paid mark (`paidOn` = the day the money arrived). */
  dueOn: string | null;
  paidAt: string | null;
  paidOn: string | null;
  paidRef: string | null;
  lines?: PartnerBillLine[];
}

export interface GenerateBillsResult {
  month: string;
  made: number;
  existing: number;
  skippedZero: number;
  unassigned: number;
  /** COMMISSION ledger rows in the month; 0 = no commission scheme produced any. */
  commissionRows: number;
  /** Entities depot-service could not describe: their depots were not billed. */
  unreadable: number;
  /** Billed depots with no franchise owner recorded, and their codes. */
  noOwner: number;
  noOwnerDepots: string[];
}

/** The month before the current WIB one, `YYYY-MM`: the one a bill is made for. */
export function lastClosedMonth(now: Date = new Date()): string {
  const key = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** "2026-11" as the month name and year the reader expects. */
export function monthName(month: string, locale: 'id' | 'en'): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // tz-ok: the 15th of a calendar month is the same day in every zone, so no zone shifts the month.
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(locale === 'id' ? 'id-ID' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
