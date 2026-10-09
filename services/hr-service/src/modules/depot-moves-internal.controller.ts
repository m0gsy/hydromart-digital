import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  ApplyDueResult,
  DepotAssignmentApplier,
} from '../application/services/depot-assignment-applier.service';
import { ApplyDueResponseDto } from './dto/depot-assignment.dto';

/**
 * The scheduler's door (crontab: every 15 minutes). Internal key only - `@Public()` bypasses
 * the JWT guard and `InternalAuthGuard` is the sole auth, the same shape as
 * `announcements/publish-due`.
 */
@ApiTags('HR Penugasan Depot')
@Controller({ path: 'employees/internal/depot-moves', version: '1' })
export class DepotMovesInternalController {
  constructor(private readonly applier: DepotAssignmentApplier) {}

  @ApiOkResponse({ type: ApplyDueResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('apply-due')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply assignments that are now due: lend, return, schedule (internal)' })
  applyDue(): Promise<ApplyDueResult> {
    return this.applier.applyDue();
  }
}
