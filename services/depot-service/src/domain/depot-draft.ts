import { addLocalDays, dayStartUtc, localDayKey } from '@hydromart/platform';

import { parseCalendarDay } from './legal-entity';

/** HD-21 (D1): the four things HQ checks before a prospect may become a depot. */
export const CHECKLIST_ITEMS = ['ktpNpwp', 'locationProof', 'capitalDeposit', 'fieldSurvey'] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];
export const CHECKLIST_STATES = ['NOT_STARTED', 'SUBMITTED', 'VERIFIED', 'REJECTED'] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];
export type DepotChecklist = Record<ChecklistItem, ChecklistState>;

/** Calendar days the prospect must have held the prospectus before signing (D1). */
export const COOLING_OFF_DAYS = 14;

/** What is wrong with the dates or the checklist; the service turns each into its typed error. */
export type DraftCheck =
  | { ok: true }
  | { ok: false; reason: 'CHECKLIST_INCOMPLETE'; items: ChecklistItem[] }
  | { ok: false; reason: 'COOLING_OFF_NOT_MET'; earliestOn: string }
  | { ok: false; reason: 'BAD_DATES'; message: string };

/** `YYYY-MM-DD` + n calendar days, via the platform's WIB day arithmetic (never hand-rolled). */
export function addDays(day: string, n: number): string {
  return localDayKey(addLocalDays(dayStartUtc(day), n));
}

/**
 * The D1 re-check. `today` is the WIB day key the caller got from `localDayKey(new Date())`, so
 * this stays pure. Order: the dates must make sense (400) before the cooling-off (422), and the
 * checklist is reported first because it is what HQ fixes first.
 */
export function checkDraft(
  input: { checklist: DepotChecklist; prospectusHandedOn: string; agreementSignedOn: string },
  today: string,
): DraftCheck {
  const { prospectusHandedOn: handed, agreementSignedOn: signed } = input;
  if (!parseCalendarDay(handed) || !parseCalendarDay(signed)) {
    return { ok: false, reason: 'BAD_DATES', message: 'Tanggal harus berupa hari kalender YYYY-MM-DD.' };
  }
  if (signed > today) {
    return { ok: false, reason: 'BAD_DATES', message: 'Tanggal penandatanganan perjanjian tidak boleh di masa depan.' };
  }
  if (handed > signed) {
    return { ok: false, reason: 'BAD_DATES', message: 'Prospektus harus diserahkan sebelum perjanjian ditandatangani.' };
  }
  const items = CHECKLIST_ITEMS.filter((i) => input.checklist[i] !== 'VERIFIED');
  if (items.length > 0) return { ok: false, reason: 'CHECKLIST_INCOMPLETE', items };
  const earliestOn = addDays(handed, COOLING_OFF_DAYS);
  if (signed < earliestOn) return { ok: false, reason: 'COOLING_OFF_NOT_MET', earliestOn };
  return { ok: true };
}

export type DepotDraftStatus = 'DRAFT' | 'ACTIVATED' | 'REJECTED';

/** What the CRM sends and a draft stores (everything the activation step will need). */
export interface DepotDraftContent {
  legacyApplicationId: string | null;
  proposedName: string;
  city: string;
  province: string;
  ownerFullName: string;
  ownerPhoneE164: string;
  prospectusHandedOn: string;
  agreementSignedOn: string;
  prospectusSha256: string;
  prospectusVersionLabel: string;
  prospectusReceipt: string;
  checklist: DepotChecklist;
}

/** A stored draft. The owner's name and phone are personal data and are NULL once HQ has decided. */
export interface DepotDraftRecord extends Omit<DepotDraftContent, 'ownerFullName' | 'ownerPhoneE164'> {
  ownerFullName: string | null;
  ownerPhoneE164: string | null;
  id: string;
  prospectId: string;
  requestHash: string;
  suggestionId: string;
  status: DepotDraftStatus;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  depotId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** HD-21b (D3): the event HQ's activation of a draft raises (contracts/ai-v1/events.openapi.json). */
export const DEPOT_ONBOARDED = 'depot.onboarded';

/** The idempotency key admin-service and the receiver dedupe on: one depot, one event, whatever the retries. */
export function depotOnboardedEventId(depotId: string): string {
  return `${DEPOT_ONBOARDED}:${depotId}`;
}

/**
 * The outbox row for an activated draft. Ids and the depot code only: no owner name or phone, no
 * address, no prospectus data. The AI web already holds the prospect; it needs to know which depot
 * the prospect became.
 */
export function depotOnboarded(d: {
  depotId: string;
  depotCode: string;
  prospectId: string;
  legacyApplicationId: string | null;
  occurredAt: Date;
}): { event: string; eventId: string; payload: Record<string, unknown>; occurredAt: Date } {
  return {
    event: DEPOT_ONBOARDED,
    eventId: depotOnboardedEventId(d.depotId),
    payload: {
      depotId: d.depotId,
      depotCode: d.depotCode,
      prospectId: d.prospectId,
      legacyApplicationId: d.legacyApplicationId,
      occurredAt: d.occurredAt.toISOString(),
    },
    occurredAt: d.occurredAt,
  };
}
