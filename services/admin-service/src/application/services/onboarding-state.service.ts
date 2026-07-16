import { Inject, Injectable } from '@nestjs/common';

import {
  OnboardingStateRecord,
  OnboardingStateRepository,
  OnboardingStep,
} from '../ports/onboarding-state.repository';
import { ADMIN_TOKENS } from '../tokens';

// Every step starts incomplete (Design 23b) — mirrors the DB column defaults.
const DEFAULTS: Omit<OnboardingStateRecord, 'updatedAt'> = {
  verify2fa: false,
  addDepot: false,
  inviteHeadOffice: false,
  setPricingTax: false,
  enablePayments: false,
};

@Injectable()
export class OnboardingStateService {
  constructor(
    @Inject(ADMIN_TOKENS.OnboardingStateRepository)
    private readonly repo: OnboardingStateRepository,
  ) {}

  /** Current wizard state, falling back to all-incomplete when unset. */
  async get(): Promise<OnboardingStateRecord> {
    const existing = await this.repo.get();
    return existing ?? { ...DEFAULTS, updatedAt: new Date(0) };
  }

  /** Mark one step done/undone. */
  setStep(step: OnboardingStep, done: boolean): Promise<OnboardingStateRecord> {
    return this.repo.setStep(step, done);
  }
}
