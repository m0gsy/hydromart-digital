// Franchise-application domain vocabulary (design 5a/5b HQ approvals). Mirrors the
// Prisma enums; the domain never imports the generated client.

export enum FranchiseAppStage {
  PENDING = 'PENDING',
  DOC_VERIFICATION = 'DOC_VERIFICATION',
  SURVEY = 'SURVEY',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** Per-document review status inside the checklist. */
export enum ChecklistItemStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

/** The four requirement items every application is reviewed against. */
export const CHECKLIST_ITEMS = ['ktpNpwp', 'locationProof', 'capitalDeposit', 'fieldSurvey'] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

export type Checklist = Record<ChecklistItem, ChecklistItemStatus>;

/** Every item PENDING — the shape a fresh application starts with. */
export function emptyChecklist(): Checklist {
  return {
    ktpNpwp: ChecklistItemStatus.PENDING,
    locationProof: ChecklistItemStatus.PENDING,
    capitalDeposit: ChecklistItemStatus.PENDING,
    fieldSurvey: ChecklistItemStatus.PENDING,
  };
}

/** APPROVED/REJECTED are terminal — no further stage/checklist edits or re-decisions. */
export function isTerminalStage(stage: FranchiseAppStage): boolean {
  return stage === FranchiseAppStage.APPROVED || stage === FranchiseAppStage.REJECTED;
}
