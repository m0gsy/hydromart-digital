import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString } from 'class-validator';

import { OnboardingStateRecord } from '../../application/ports/onboarding-state.repository';

const STEPS = [
  'verify2fa',
  'addDepot',
  'inviteHeadOffice',
  'setPricingTax',
  'enablePayments',
] as const;

/* ---------- Requests ---------- */

/** Mark one wizard step done/undone. */
export class PatchOnboardingDto {
  @ApiProperty({ enum: STEPS })
  @IsString()
  @IsIn(STEPS as unknown as string[])
  step!: (typeof STEPS)[number];

  @ApiProperty({ example: true })
  @IsBoolean()
  done!: boolean;
}

/* ---------- Responses ---------- */

export class OnboardingStateDto {
  @ApiProperty()
  verify2fa!: boolean;
  @ApiProperty()
  addDepot!: boolean;
  @ApiProperty()
  inviteHeadOffice!: boolean;
  @ApiProperty()
  setPricingTax!: boolean;
  @ApiProperty()
  enablePayments!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(record: OnboardingStateRecord): OnboardingStateDto {
    return {
      verify2fa: record.verify2fa,
      addDepot: record.addDepot,
      inviteHeadOffice: record.inviteHeadOffice,
      setPricingTax: record.setPricingTax,
      enablePayments: record.enablePayments,
      updatedAt: record.updatedAt,
    };
  }
}
