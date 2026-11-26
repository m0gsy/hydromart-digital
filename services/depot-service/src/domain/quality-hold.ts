import { createHash } from 'node:crypto';

import { localDayKey } from '@hydromart/platform';

// HD-14: quality hold, lab tests and permits. Mirrors the Prisma enums; the domain never imports
// the generated client. Every day below is a WIB day key (YYYY-MM-DD).

export type QualityHoldStatus = 'ACTIVE' | 'ENDED';
export type QualityHoldReason = 'LAB_FAIL' | 'PERMIT' | 'COMPLAINT' | 'OTHER';
export type LabTestKind = 'FISIK_MIKRO' | 'KIMIA' | 'ECOLI' | 'LENGKAP';
export type LabTestResult = 'PASS' | 'FAIL';

export const QUALITY_HOLD_REASONS: readonly QualityHoldReason[] = ['LAB_FAIL', 'PERMIT', 'COMPLAINT', 'OTHER'];
export const LAB_TEST_KINDS: readonly LabTestKind[] = ['FISIK_MIKRO', 'KIMIA', 'ECOLI', 'LENGKAP'];

export interface QualityHold {
  id: string;
  depotId: string;
  status: QualityHoldStatus;
  reasonCode: QualityHoldReason;
  /** Staff text. Never in an event and never shown to a customer. */
  note: string | null;
  startedBy: string;
  startedAt: Date;
  endedBy: string | null;
  endedAt: Date | null;
  endRetestId: string | null;
}

export interface LabTest {
  id: string;
  depotId: string;
  kind: LabTestKind;
  takenOn: string;
  resultOn: string;
  result: LabTestResult;
  labName: string;
  reportNo: string;
  recordedBy: string;
  createdAt: Date;
}

export interface Permit {
  id: string;
  depotId: string;
  kind: string;
  number: string;
  validUntil: string;
  recordedBy: string;
  createdAt: Date;
}

/** What the depot lists and detail answers say about a hold (no reason, no note). */
export interface QualityHoldFlag {
  active: boolean;
  since: string | null;
}

export const noHold: QualityHoldFlag = { active: false, since: null };

/** The flag a depot's active hold (if any) puts on its public answers. */
export const holdFlag = (startedAt: Date | null | undefined): QualityHoldFlag =>
  startedAt ? { active: true, since: startedAt.toISOString() } : noHold;

/** The event an outbox row carries when a hold starts or ends (contracts/ai-v1/events.openapi.json). */
export const QUALITY_HOLD_CHANGED = 'depot.quality_hold_changed';

/**
 * Ids, status and time only: the reason and the note are staff text and never leave hydromart.
 * One event per (hold, status), so a retry of the same change is the same row.
 */
export function qualityHoldChanged(
  holdId: string,
  depotId: string,
  status: QualityHoldStatus,
  at: Date,
): { event: string; eventId: string; payload: Record<string, unknown>; occurredAt: Date } {
  return {
    event: QUALITY_HOLD_CHANGED,
    eventId: `${QUALITY_HOLD_CHANGED}:${holdId}:${status}`,
    payload: { depotId, status, changedAt: at.toISOString() },
    occurredAt: at,
  };
}

/**
 * Ending needs a PASS test of THIS depot taken on or after the day the hold started: a retest
 * alone never ends a hold (a person presses End), and an old pass proves nothing about now.
 */
export function endsHold(hold: Pick<QualityHold, 'depotId' | 'startedAt'>, test: LabTest | null): boolean {
  return (
    test !== null &&
    test.depotId === hold.depotId &&
    test.result === 'PASS' &&
    test.takenOn >= localDayKey(hold.startedAt)
  );
}

// --- due dates (computed here; n8n only says "now") -------------------------------------------

/**
 * Days between required tests, per kind. ponytail: code constants until Dinkes answers (open
 * question in the Rencana Induk). Stricter reading of the annex: physical/microbiology monthly,
 * E. coli every 3 months, chemistry every 6 months. A LENGKAP (full panel) counts for all three.
 */
export const LAB_TEST_EVERY_DAYS = { FISIK_MIKRO: 30, ECOLI: 90, KIMIA: 180 } as const;
type RequiredKind = keyof typeof LAB_TEST_EVERY_DAYS;
const LAB_TEST_NAME: Record<RequiredKind, string> = {
  FISIK_MIKRO: 'Uji fisik dan mikrobiologi',
  ECOLI: 'Uji E. coli',
  KIMIA: 'Uji kimia',
};

/** A permit is reminded from this many days before its validUntil, and every run after that. */
export const PERMIT_REMIND_DAYS = 30;

const DAY_MS = 86_400_000;

/** A real calendar day in YYYY-MM-DD (the DTO checks the shape; 2026-02-31 passes the shape). */
export const isRealDay = (day: string): boolean => {
  const t = Date.parse(day);
  // tz-ok: a day key parsed as UTC midnight and read back as UTC is a pure calendar round trip
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day;
};
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

// tz-ok: `day` is already a WIB day key parsed as UTC midnight, so the UTC slice IS that local day
const addDays = (day: string, n: number): string => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

/** One permit or lab test that is due or overdue, as crm-service reads it for the reminder. */
export interface DueCompliance {
  /** Stable per item: the permit's id, or a hash of depot + test kind (a test kind has no row of its own). */
  id: string;
  depotId: string;
  depotName: string;
  kind: 'PERMIT' | 'LAB_TEST';
  name: string;
  /** The day it falls (fell) due. */
  dueOn: string;
  /** Days left until dueOn; zero or negative = due today or overdue. */
  daysLeft: number;
  /** The day this due cycle began (the last test's day, the permit's validity end), so a renewed item is a new cycle. */
  cycleStart: string;
}

const pseudoId = (depotId: string, kind: string): string =>
  createHash('sha1').update(`${depotId}:${kind}`).digest('hex').slice(0, 32);

/** Lab tests due at one depot: per required kind, the day of the latest test of that kind (or a full panel). */
export function labTestsDue(
  depot: { id: string; name: string; createdOn: string },
  tests: ReadonlyArray<Pick<LabTest, 'kind' | 'takenOn'>>,
  today: string,
): DueCompliance[] {
  const out: DueCompliance[] = [];
  for (const kind of Object.keys(LAB_TEST_EVERY_DAYS) as RequiredKind[]) {
    const taken = tests.filter((t) => t.kind === kind || t.kind === 'LENGKAP').map((t) => t.takenOn);
    // Never tested: the clock starts the day the depot was added, not at zero.
    const cycleStart = taken.length > 0 ? taken.reduce((a, b) => (a > b ? a : b)) : depot.createdOn;
    const dueOn = addDays(cycleStart, LAB_TEST_EVERY_DAYS[kind]);
    const daysLeft = daysBetween(today, dueOn);
    if (daysLeft > 0) continue;
    out.push({
      id: pseudoId(depot.id, kind),
      depotId: depot.id,
      depotName: depot.name,
      kind: 'LAB_TEST',
      name: LAB_TEST_NAME[kind],
      dueOn,
      daysLeft,
      cycleStart,
    });
  }
  return out;
}

/** Permits of one depot that are due: the latest validUntil per kind, within PERMIT_REMIND_DAYS of today. */
export function permitsDue(
  depot: { id: string; name: string },
  permits: ReadonlyArray<Pick<Permit, 'id' | 'kind' | 'number' | 'validUntil'>>,
  today: string,
): DueCompliance[] {
  const latest = new Map<string, (typeof permits)[number]>();
  for (const p of permits) {
    const seen = latest.get(p.kind);
    if (!seen || p.validUntil > seen.validUntil) latest.set(p.kind, p);
  }
  const out: DueCompliance[] = [];
  for (const p of latest.values()) {
    const daysLeft = daysBetween(today, p.validUntil);
    if (daysLeft > PERMIT_REMIND_DAYS) continue;
    out.push({
      id: p.id,
      depotId: depot.id,
      depotName: depot.name,
      kind: 'PERMIT',
      name: `${p.kind} ${p.number}`,
      dueOn: p.validUntil,
      daysLeft,
      cycleStart: p.validUntil,
    });
  }
  return out;
}
