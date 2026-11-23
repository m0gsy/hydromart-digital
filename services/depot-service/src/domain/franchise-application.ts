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
export const CHECKLIST_ITEMS = [
  'ktpNpwp',
  'locationProof',
  'capitalDeposit',
  'fieldSurvey',
] as const;
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

/**
 * HD-8: the Kebijakan Privasi version an application's consent box agreed to, stamped on every
 * application. The date the policy page shows as `effective` (apps/web/src/lib/dictionaries/
 * {id,en}/privacy.ts); apps/web/test/legal-versions.test.ts fails when the two differ, because
 * a stored version naming a text nobody was shown is worse than none.
 */
export const PRIVACY_POLICY_VERSION = '2026-11-23';

/**
 * HD-8: a campaign code as the web stores it (lib/attribution.ts): lower case, 1 to 64 of
 * a-z 0-9 . _ - and not starting with a symbol. The same pattern as auth-service's signup.
 */
export const SOURCE_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** HD-7: the event a new application raises (contracts/ai-v1/events.openapi.json). */
export const FRANCHISE_APPLICATION_SUBMITTED = 'franchise.application_submitted';

/** The idempotency key admin-service and the receiver dedupe this application's event on. */
export function franchiseApplicationSubmittedEventId(applicationId: string): string {
  return `${FRANCHISE_APPLICATION_SUBMITTED}:${applicationId}`;
}

/**
 * The outbox row for a submitted application. No personal data: name, phone, GPS pin and the
 * amounts stay here, behind HQ's own screen; moving contact data into the AI web CRM is Tahap 2,
 * after the /waralaba consent is stored (HD-8).
 */
export function franchiseApplicationSubmitted(app: {
  id: string;
  city: string;
  province: string;
  submittedAt: Date;
}): { event: string; eventId: string; payload: Record<string, unknown>; occurredAt: Date } {
  return {
    event: FRANCHISE_APPLICATION_SUBMITTED,
    eventId: franchiseApplicationSubmittedEventId(app.id),
    payload: { applicationId: app.id, city: app.city, province: app.province },
    occurredAt: app.submittedAt,
  };
}
