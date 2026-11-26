// HD-5: legal entities (Indowater, Kelola, each franchise partner) and the dated record of which
// one a depot belongs to. Mirrors the Prisma models; the domain never imports the client.

import { OwnershipType } from './inventory';

/** What a legal entity is to the business: brand + franchise, HKP operator, or a partner. */
export type LegalEntityKind = 'FRANCHISOR' | 'OPERATOR' | 'FRANCHISEE';

export const LEGAL_ENTITY_KINDS: readonly LegalEntityKind[] = ['FRANCHISOR', 'OPERATOR', 'FRANCHISEE'];

export interface LegalEntity {
  id: string;
  name: string;
  kind: LegalEntityKind;
  active: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** HD-23: the official account a partner bill is paid into; read for the FRANCHISOR entity only. */
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
}

/** HD-23: the three bank fields of an entity, all or nothing (a half-entered account is no account). */
export interface BankAccount {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

/** The entity's account when all three parts are filled in, else null. */
export function bankAccountOf(
  e: Pick<LegalEntity, 'bankName' | 'bankAccountNumber' | 'bankAccountHolder'>,
): BankAccount | null {
  return e.bankName && e.bankAccountNumber && e.bankAccountHolder
    ? { bankName: e.bankName, bankAccountNumber: e.bankAccountNumber, bankAccountHolder: e.bankAccountHolder }
    : null;
}

/** A legal entity as the admin screen reads it, with the roles that may read it in the AI web. */
export interface LegalEntityRecord extends LegalEntity {
  aiReadRoles: string[];
}

/** One dated change point: from `effectiveFrom` (a calendar day) the depot belongs to the entity. */
export interface DepotLegalEntityPoint {
  id: string;
  depotId: string;
  legalEntityId: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  recordedBy: string | null;
  recordedAt: Date;
}

/** A depot and its change points, newest first. */
export interface DepotLegalEntityHistory {
  depotId: string;
  code: string;
  name: string;
  ownershipType: OwnershipType;
  active: boolean;
  points: DepotLegalEntityPoint[];
}

/**
 * One stretch of a period during which a depot belonged to one legal entity (null: none was
 * recorded yet). `from` is the first day of the stretch inside the period, `YYYY-MM-DD`.
 */
export interface DepotEntitySpan {
  depotId: string;
  legalEntityId: string | null;
  from: string;
}

/**
 * HD-6: which legal entity each depot belonged to over `[from, to]` (calendar days). W-06 rule:
 * on day D a depot belongs to the row with the latest `effectiveFrom <= D`, so the answer is the
 * entity in force on `from`, then one more span at every change point inside `(from, to]`.
 * A depot with no row by `from` starts with `legalEntityId: null`. `points` may hold other depots.
 */
export function entitySpans(
  depotIds: readonly string[],
  points: ReadonlyArray<{ depotId: string; legalEntityId: string; effectiveFrom: string }>,
  from: string,
  to: string,
): DepotEntitySpan[] {
  return depotIds.flatMap((depotId) => {
    const own = points
      .filter((p) => p.depotId === depotId && p.effectiveFrom <= to)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const inForce = own.filter((p) => p.effectiveFrom <= from).pop();
    return [
      { depotId, legalEntityId: inForce?.legalEntityId ?? null, from },
      ...own
        .filter((p) => p.effectiveFrom > from)
        .map((p) => ({ depotId, legalEntityId: p.legalEntityId, from: p.effectiveFrom })),
    ];
  });
}

/** The name as stored: outer spaces trimmed, inner runs of whitespace collapsed to one space. */
export function normaliseLegalEntityName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` -> the UTC midnight Prisma stores a `@db.Date` as, or null when the text is not a
 * real calendar day (2026-02-30 is refused, not rolled over into March).
 */
export function parseCalendarDay(text: string): Date | null {
  const m = CALENDAR_DAY.exec(text);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return formatCalendarDay(day) === text ? day : null;
}

/** The calendar day a `@db.Date` holds, as `YYYY-MM-DD`. */
export function formatCalendarDay(day: Date): string {
  // tz-ok: a @db.Date is stored as UTC midnight, so the UTC slice IS the calendar day.
  return day.toISOString().slice(0, 10);
}
