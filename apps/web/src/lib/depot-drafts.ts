// HD-21b: the depot drafts the AI web's CRM made, as depot-service answers HQ.
import { dateInDaysWib, dayStartWib } from '@/lib/wib';

export type DepotDraftStatus = 'DRAFT' | 'ACTIVATED' | 'REJECTED';
export type ChecklistState = 'NOT_STARTED' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
export const DRAFT_CHECKLIST = ['ktpNpwp', 'locationProof', 'capitalDeposit', 'fieldSurvey'] as const;
export type DraftChecklistKey = (typeof DRAFT_CHECKLIST)[number];

/** One row of HQ's list: no owner phone and nothing internal. Open drafts come oldest first. */
export interface DepotDraftListItem {
  id: string;
  proposedName: string;
  city: string;
  province: string;
  status: DepotDraftStatus;
  checklist: { verified: number; total: number };
  createdAt: string;
  decidedAt: string | null;
  ageDays: number;
}

export interface DepotDraft {
  id: string;
  prospectId: string;
  legacyApplicationId: string | null;
  proposedName: string;
  city: string;
  province: string;
  /** Personal data: null once HQ has decided. */
  ownerFullName: string | null;
  ownerPhoneE164: string | null;
  prospectusHandedOn: string;
  agreementSignedOn: string;
  prospectusSha256: string;
  prospectusVersionLabel: string;
  prospectusReceipt: string;
  checklist: Record<DraftChecklistKey, ChecklistState>;
  status: DepotDraftStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  depotId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The first WIB day the agreement may be signed: 14 calendar days after the prospectus. */
export function earliestSigning(handedOn: string): string {
  return dateInDaysWib(14, new Date(dayStartWib(handedOn)));
}
