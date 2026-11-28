import {
  Body,
  Controller,
  Get,
  Header,
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

import { AuthenticatedUser, Can, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import { DepotConfigService } from '../config/depot-config.service';
import {
  ApproveResult,
  FranchiseApplicationService,
} from '../application/services/franchise-application.service';
import { ApplicationSummary, FranchiseApplicationRecord } from '../application/ports/franchise-application.repository';
import {
  emptyChecklist,
  FranchiseAppStage,
  PRIVACY_POLICY_VERSION,
} from '../domain/franchise-application';
import { Page } from '../application/pagination';
import {
  ApplicationSummaryQueryDto,
  ApplicationSummaryResponseDto,
  DecisionReasonDto,
  LeadFormResponseDto,
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
  constructor(
    private readonly applications: FranchiseApplicationService,
    private readonly config: DepotConfigService,
  ) {}

  /**
   * HD-22: tells /waralaba (web and the apps) where the AI web partner form lives; `url` is null
   * while FRANCHISE_LEAD_FORM_URL is unset. No auth, no personal data, cacheable. Static segment,
   * declared before ':id'. The submit route below stays live for old installed apps.
   */
  @ApiOkResponse({ type: LeadFormResponseDto })
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @Get('lead-form')
  @ApiOperation({ summary: 'Where the partner application form lives now (public)' })
  leadForm(): { url: string | null } {
    return { url: this.config.franchiseLeadFormUrl };
  }


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

  /**
   * HD-6 H5, dashboard-service's AI read API: how many applications were submitted in a window and
   * the stage each is in now. Counts only. Static segment, declared before ':id'.
   */
  @ApiOkResponse({ type: ApplicationSummaryResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/summary')
  @ApiOperation({ summary: 'Applications submitted in [from, to) by current stage (internal, counts only)' })
  summary(@Query() query: ApplicationSummaryQueryDto): Promise<ApplicationSummary> {
    return this.applications.summary(new Date(query.from), new Date(query.to));
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
      // HD-8: both or neither, so a lone code is the first source and the latest alike.
      firstSource: dto.firstSource ?? dto.lastSource ?? null,
      lastSource: dto.lastSource ?? dto.firstSource ?? null,
      // The box is required above, so every accepted application agreed to the text in force.
      privacyConsentVersion: PRIVACY_POLICY_VERSION,
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
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DecisionReasonDto,
  ): Promise<ApproveResult> {
    return this.applications.approve(id, user.sub, dto?.reason);
  }

  @ApiOkResponse({ type: FranchiseApplicationResponseDto })
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an application' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DecisionReasonDto,
  ): Promise<FranchiseApplicationRecord> {
    return this.applications.reject(id, user.sub, dto?.reason);
  }
}
