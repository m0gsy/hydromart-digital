import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import {
  ApproveResult,
  FranchiseApplicationService,
} from '../application/services/franchise-application.service';
import { FranchiseApplicationRecord } from '../application/ports/franchise-application.repository';
import { Page } from '../application/pagination';
import { ListApplicationsQueryDto, PatchApplicationDto } from './dto/franchise-application.dto';

/**
 * HQ franchise-application approvals queue (design 5a/5b). HQ-only: HEAD_OFFICE +
 * SUPER_ADMIN, gated directly on the roles (mirrors the staffAdmin capability), since
 * this queue is not part of the shared per-depot capability matrix.
 */
@ApiTags('Franchise applications')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
@Controller({ path: 'franchise-applications', version: '1' })
export class FranchiseApplicationController {
  constructor(private readonly applications: FranchiseApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'List the approvals queue (oldest-first by SLA age)' })
  list(@Query() query: ListApplicationsQueryDto): Promise<Page<FranchiseApplicationRecord>> {
    return this.applications.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      stage: query.stage,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an application detail' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<FranchiseApplicationRecord> {
    return this.applications.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update stage and/or the document checklist' })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchApplicationDto,
  ): Promise<FranchiseApplicationRecord> {
    return this.applications.patch(id, { stage: dto.stage, checklist: dto.checklist });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve → returns the proposed-depot onboard prefill' })
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<ApproveResult> {
    return this.applications.approve(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an application' })
  reject(@Param('id', ParseUUIDPipe) id: string): Promise<FranchiseApplicationRecord> {
    return this.applications.reject(id);
  }
}
