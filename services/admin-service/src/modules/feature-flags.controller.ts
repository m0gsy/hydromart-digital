import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { FeatureFlagService } from '../application/services/feature-flag.service';
import { FeatureFlagDto, UpdateFeatureFlagDto } from './dto/feature-flag.dto';

// Design 8b — feature flags. Reading is head-office + super-admin; changing a flag is
// super-admin only (matching the task's "SUPER_ADMIN (+ HEAD_OFFICE read)" gate).
@ApiTags('Feature flags')
@ApiBearerAuth()
@Controller({ path: 'feature-flags', version: '1' })
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagService) {}

  @ApiOkResponse({ type: FeatureFlagDto, isArray: true })
  @Can('hqConsole')
  @Get()
  @ApiOperation({ summary: 'List all feature flags (8b)' })
  async list(): Promise<FeatureFlagDto[]> {
    return (await this.flags.list()).map((f) => FeatureFlagDto.from(f));
  }

  @ApiOkResponse({ type: FeatureFlagDto })
  @Can('platformAdmin')
  @Patch(':key')
  @ApiOperation({ summary: "Toggle a feature flag's state / rollout percentage (8b)" })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagDto> {
    return FeatureFlagDto.from(await this.flags.update(key, dto));
  }
}
