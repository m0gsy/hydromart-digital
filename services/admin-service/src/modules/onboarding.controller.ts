import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { OnboardingStateService } from '../application/services/onboarding-state.service';
import { OnboardingStateDto, PatchOnboardingDto } from './dto/onboarding-state.dto';

// Design 23b — first-run HQ onboarding wizard state (singleton). SUPER_ADMIN only.
@ApiTags('Onboarding wizard')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'onboarding', version: '1' })
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingStateService) {}

  @Get()
  @ApiOperation({ summary: 'Read the onboarding wizard state (23b)' })
  async get(): Promise<OnboardingStateDto> {
    return OnboardingStateDto.from(await this.onboarding.get());
  }

  @Patch()
  @ApiOperation({ summary: 'Mark one wizard step done/undone' })
  async patch(@Body() dto: PatchOnboardingDto): Promise<OnboardingStateDto> {
    return OnboardingStateDto.from(await this.onboarding.setStep(dto.step, dto.done));
  }
}
