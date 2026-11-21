import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  FaceMaintenanceResult,
  FaceMaintenanceService,
} from '../application/services/face-maintenance.service';

/** The scheduler's door to the daily face upkeep (owner decision 2026-11-21). */
@ApiTags('Employees')
@Controller({ path: 'employees', version: '1' })
export class FaceMaintenanceController {
  constructor(private readonly upkeep: FaceMaintenanceService) {}

  @ApiOkResponse({ description: 'What the upkeep retired, deleted and purged, and whether it worked.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/faces/maintain')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconcile HR enrolments with the face engine; purge old samples (internal)' })
  maintain(): Promise<FaceMaintenanceResult> {
    return this.upkeep.run();
  }
}
