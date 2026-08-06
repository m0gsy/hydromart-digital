import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { PurgeRunResult, PurgeService } from '../application/services/purge.service';
import { RetentionService } from '../application/services/retention.service';
import {
  BackupStatusDto,
  PurgePlanEntryDto,
  RecordBackupRunDto,
  RetentionOverviewDto,
  RetentionPolicyDto,
  UpdateRetentionDto,
} from './dto/retention.dto';
import { PurgeRunResponseDto } from './dto/responses.generated.dto';

// Design 19e — retention windows per dataset + read-only backup status. SUPER_ADMIN only.
// Backup status has NO engine wired → it is returned and labeled honestly, never faked.
@ApiTags('Retention & backup')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller({ path: 'retention', version: '1' })
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly purge: PurgeService,
  ) {}

  @ApiOkResponse({ type: RetentionOverviewDto })
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

  @ApiOkResponse({ type: PurgePlanEntryDto, isArray: true })
  @Get('purge-plan')
  @ApiOperation({
    summary: 'What a purge would be allowed to delete today, per dataset (M23-21)',
    description: 'Read-only. FINANCIAL datasets always report cutoff null.',
  })
  async purgePlan(): Promise<PurgePlanEntryDto[]> {
    return (await this.retention.purgeCutoffs()).map(PurgePlanEntryDto.from);
  }

  @ApiOkResponse({ type: PurgeRunResponseDto })
  @Post('purge')
  @ApiOperation({
    summary: 'Run the retention sweep now',
    description:
      'Deletes rows past their window for datasets that have an executor, and reports every other dataset as UNENFORCED rather than skipping it silently. FINANCIAL is never touched. Pass dryRun=true to see the plan without deleting.',
  })
  runPurge(@Query('dryRun') dryRun?: string): Promise<PurgeRunResult> {
    return this.purge.run({ dryRun: dryRun === 'true' });
  }

  /**
   * The nightly sweep, called by the scheduler sidecar with the shared internal key —
   * crond has no JWT to present. @Public() bypasses the global JWT guard; InternalAuthGuard
   * is then the sole, fail-closed auth.
   */
  @ApiOkResponse({ type: PurgeRunResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/purge')
  @ApiOperation({ summary: 'Run the retention sweep (internal service auth)' })
  runPurgeInternal(): Promise<PurgeRunResult> {
    return this.purge.run();
  }

  /**
   * H-37 — where scripts/backup-db.sh and scripts/restore-db.sh report what actually
   * happened. Same internal-key auth as the purge sweep: these are shell jobs on the VPS
   * with no JWT to present. Recording a FAILED run matters as much as an OK one, because
   * a failure that only reaches a cron log nobody reads is what makes an unusable backup
   * look like a working one.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/backup-status')
  @ApiOperation({ summary: 'Record a backup or restore-drill outcome (internal service auth)' })
  @ApiOkResponse({ type: BackupStatusDto })
  async recordBackupRun(@Body() dto: RecordBackupRunDto): Promise<BackupStatusDto> {
    return BackupStatusDto.from(
      await this.retention.recordBackupRun({
        kind: dto.kind,
        status: dto.status,
        at: new Date(),
        detail: dto.detail ?? null,
      }),
    );
  }

  @ApiOkResponse({ type: RetentionPolicyDto })
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
