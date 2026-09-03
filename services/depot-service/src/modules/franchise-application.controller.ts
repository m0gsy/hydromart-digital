import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Can, InternalAuthGuard, Public } from '@hydromart/platform';

import {
  ApproveResult,
  FranchiseApplicationService,
} from '../application/services/franchise-application.service';
import { FranchiseApplicationRecord } from '../application/ports/franchise-application.repository';
import { emptyChecklist, FranchiseAppStage } from '../domain/franchise-application';
import { Page } from '../application/pagination';
import {
  ListApplicationsQueryDto,
  PatchApplicationDto,
  PurgeRejectedApplicationsDto,
  PurgeRejectedResponseDto,
  SubmitFranchiseApplicationDto,
  SubmittedApplicationView,
} from './dto/franchise-application.dto';
import {
  ApproveResponseDto,
  FranchiseApplicationResponseDto,
  PagedFranchiseApplicationResponseDto,
} from './dto/responses.generated.dto';

/**
 * HQ franchise-application approvals queue (design 5a/5b). HQ-only: HEAD_OFFICE +
 * SUPER_ADMIN, gated directly on the roles (mirrors the staffAdmin capability), since
 * this queue is not part of the shared per-depot capability matrix.
 */
@ApiTags('Franchise applications')
@ApiBearerAuth()
@Can('franchiseApplications')
@Controller({ path: 'franchise-applications', version: '1' })
export class FranchiseApplicationController {
  constructor(private readonly applications: FranchiseApplicationService) {}

  /**
   * A prospective partner applies. The ONLY public route here — the rest of this
   * controller is the HQ queue. Everything that decides an application's fate (stage,
   * checklist) is set server-side, and the response is a receipt rather than the record,
   * so an anonymous submitter can neither pre-verify themselves nor read the pipeline.
   *
   * Throttled far below the global per-IP allowance: this is the one unauthenticated
   * route that writes rows a human then has to read, and nobody applies for five depots
   * in an hour. ponytail: no captcha — add one only if the queue starts collecting junk.
   */
  /*
   * CA-3-53 — retention. Rejected applications had no window at all: a name, a WhatsApp
   * number and a GPS pin belonging to somebody we told no, kept forever. Declared before
   * ':id' so the static segment wins the route match.
   *
   * `@Public()` + InternalAuthGuard OVERRIDES the class-level `@Can('franchiseApplications')`:
   * the caller is admin-service's retention sweep with the shared internal key, not a
   * console session.
   */
  @ApiOkResponse({ type: PurgeRejectedResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/purge-rejected')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete rejected applications older than the cutoff (internal, UU PDP)',
  })
  purgeRejected(@Body() dto: PurgeRejectedApplicationsDto): Promise<{ deleted: number }> {
    return this.applications.purgeRejectedOlderThan(new Date(dto.cutoff));
  }

  @ApiOkResponse({ type: SubmittedApplicationView })
  @Public()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a franchise application (public)' })
  async submit(@Body() dto: SubmitFranchiseApplicationDto): Promise<SubmittedApplicationView> {
    const created = await this.applications.create({
      applicantName: dto.applicantName,
      applicantPhone: dto.applicantPhone,
      proposedCode: dto.proposedCode.trim().toUpperCase(),
      proposedName: dto.proposedName,
      city: dto.city,
      province: dto.province,
      lat: dto.lat,
      lng: dto.lng,
      investmentAmount: dto.investmentAmount,
      projectedMonthlyRevenue: dto.projectedMonthlyRevenue,
      checklist: emptyChecklist(),
      stage: FranchiseAppStage.PENDING,
    });
    return SubmittedApplicationView.from(created);
  }

  @ApiOkResponse({ type: PagedFranchiseApplicationResponseDto })
  @Get()
  @ApiOperation({ summary: 'List the approvals queue (oldest-first by SLA age)' })
  list(@Query() query: ListApplicationsQueryDto): Promise<Page<FranchiseApplicationRecord>> {
    return this.applications.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      stage: query.stage,
    });
  }

  @ApiOkResponse({ type: FranchiseApplicationResponseDto })
  @Get(':id')
  @ApiOperation({ summary: 'Get an application detail' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<FranchiseApplicationRecord> {
    return this.applications.get(id);
  }

  @ApiOkResponse({ type: FranchiseApplicationResponseDto })
  @Patch(':id')
  @ApiOperation({ summary: 'Update stage and/or the document checklist' })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchApplicationDto,
  ): Promise<FranchiseApplicationRecord> {
    return this.applications.patch(id, { stage: dto.stage, checklist: dto.checklist });
  }

  @ApiOkResponse({ type: ApproveResponseDto })
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve → returns the proposed-depot onboard prefill' })
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<ApproveResult> {
    return this.applications.approve(id);
  }

  @ApiOkResponse({ type: FranchiseApplicationResponseDto })
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an application' })
  reject(@Param('id', ParseUUIDPipe) id: string): Promise<FranchiseApplicationRecord> {
    return this.applications.reject(id);
  }
}
