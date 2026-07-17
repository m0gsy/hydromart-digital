import { Injectable } from '@nestjs/common';

import {
  OnboardingStateRecord,
  OnboardingStateRepository,
  OnboardingStep,
} from '../../application/ports/onboarding-state.repository';
import { PrismaService } from './prisma.service';

// The state table holds exactly one row, keyed by this fixed id.
const SINGLETON_ID = 'singleton';

@Injectable()
export class OnboardingStatePrismaRepository implements OnboardingStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<OnboardingStateRecord | null> {
    const row = await this.prisma.onboardingState.findUnique({ where: { id: SINGLETON_ID } });
    return row ? this.toRecord(row) : null;
  }

  async setStep(step: OnboardingStep, done: boolean): Promise<OnboardingStateRecord> {
    const row = await this.prisma.onboardingState.upsert({
      where: { id: SINGLETON_ID },
      update: { [step]: done },
      create: { id: SINGLETON_ID, [step]: done },
    });
    return this.toRecord(row);
  }

  private toRecord(row: {
    verify2fa: boolean;
    addDepot: boolean;
    inviteHeadOffice: boolean;
    setPricingTax: boolean;
    enablePayments: boolean;
    updatedAt: Date;
  }): OnboardingStateRecord {
    const { verify2fa, addDepot, inviteHeadOffice, setPricingTax, enablePayments, updatedAt } = row;
    return { verify2fa, addDepot, inviteHeadOffice, setPricingTax, enablePayments, updatedAt };
  }
}
