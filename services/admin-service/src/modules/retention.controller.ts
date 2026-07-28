import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { RetentionService } from '../application/services/retention.service';
import {
  BackupStatusDto,
  PurgePlanEntryDto,
  RetentionOverviewDto,
  RetentionPolicyDto,
  UpdateRetentionDto,
} from './dto/retention.dto';

// Design 19e — retention windows per dataset + read-only backup status. SUPER_ADMIN only.
// Backup status has NO engine wired → it is returned and labeled honestly, never faked.
@ApiTags('Retention & backup')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'retention', version: '1' })
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  @ApiOperation({ summary: 'List retention windows + read-only backup status (19e)' })
  async get(): Promise<RetentionOverviewDto> {
    const [policies, backup] = await Promise.all([
      this.retention.listPolicies(),
      this.retention.getBackupStatus(),
    ]);
    return {
      policies: policies.map(RetentionPolicyDto.from),
      backup: BackupStatusDto.from(backup),
    };
  }

  @Get('purge-plan')
  @ApiOperation({
    summary: 'What a purge would be allowed to delete today, per dataset (M23-21)',
    description:
      'Read-only. No purge engine is wired; FINANCIAL datasets always report cutoff null.',
  })
  async purgePlan(): Promise<PurgePlanEntryDto[]> {
    return (await this.retention.purgeCutoffs()).map(PurgePlanEntryDto.from);
  }

  @Put(':id')
  @ApiOperation({ summary: "Update one dataset's retention window" })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRetentionDto,
  ): Promise<RetentionPolicyDto> {
    return RetentionPolicyDto.from(
      await this.retention.updatePolicy(id, {
        windowLabel: dto.windowLabel,
        windowDays: dto.windowDays,
        dataClass: dto.dataClass,
      }),
    );
  }
}
