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
