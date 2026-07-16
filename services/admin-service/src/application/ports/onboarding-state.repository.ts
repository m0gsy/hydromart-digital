/** The five first-run setup steps (Design 23b). */
export type OnboardingStep =
  | 'verify2fa'
  | 'addDepot'
  | 'inviteHeadOffice'
  | 'setPricingTax'
  | 'enablePayments';

export interface OnboardingStateRecord {
  verify2fa: boolean;
  addDepot: boolean;
  inviteHeadOffice: boolean;
  setPricingTax: boolean;
  enablePayments: boolean;
  updatedAt: Date;
}

export interface OnboardingStateRepository {
  /** Read the singleton state, or null when it has never been written. */
  get(): Promise<OnboardingStateRecord | null>;
  /** Mark one step done/undone; upserts the singleton. */
  setStep(step: OnboardingStep, done: boolean): Promise<OnboardingStateRecord>;
}
