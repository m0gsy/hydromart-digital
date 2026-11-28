import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
  ExternalAccess,
} from '@hydromart/platform';

import { GenerateResult, OpenBill, PartnerBillService } from '../application/services/partner-bill.service';
import { PartnerBillRecord } from '../domain/partner-bill';
import {
  GenerateBillsDto,
  GenerateBillsResponseDto,
  MarkPaidDto,
  OpenBillResponseDto,
  PartnerBillListQueryDto,
  PartnerBillResponseDto,
  VoidBillDto,
} from './dto/partner-bill.dto';

/** A bill as the API shows it: the owners it went to are counted, never listed. */
const view = ({ recipientIds, ...bill }: PartnerBillRecord) => ({ ...bill, recipients: recipientIds.length });

/**
 * HD-23 - the monthly royalty bill. Finance reads, makes drafts and approves (approve = send);
 * a franchise owner reads the bills sent to them. Every write is audited.
 */
@ApiTags('Partner bills')
@ApiBearerAuth()
@Controller({ path: 'partner-bills', version: '1' })
export class PartnerBillController {
  constructor(private readonly bills: PartnerBillService) {}

  @ApiOkResponse({ type: PartnerBillResponseDto, isArray: true })
  @Can('partnerBillRead')
  @Get()
  @ApiOperation({ summary: 'Partner bills, newest month first (filter by month, entity, status)' })
  async list(@Query() query: PartnerBillListQueryDto) {
    return (await this.bills.list(query)).map(view);
  }

  /** Declared before `:id` so the static segment wins. */
  @ApiOkResponse({ type: PartnerBillResponseDto, isArray: true })
  @Can('payout')
  @Get('mine')
  @ApiOperation({ summary: 'The bills sent to the calling franchise owner, with their lines' })
  async mine(@CurrentUser() user: AuthenticatedUser) {
    return (await this.bills.forOwner(user.sub)).map(view);
  }

  @ApiOkResponse({ type: PartnerBillResponseDto })
  @Can('partnerBillRead')
  @Get(':id')
  @ApiOperation({ summary: 'One bill with its lines and what each is made of' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return view(await this.bills.get(id));
  }

  @ApiOkResponse({ type: GenerateBillsResponseDto })
  @Can('partnerBillApprove')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make the drafts of a closed month now (the same run n8n triggers)' })
  generate(@Body() dto: GenerateBillsDto): Promise<GenerateResult> {
    return this.bills.generate(dto.month);
  }

  @ApiOkResponse({ type: PartnerBillResponseDto })
  @Can('partnerBillApprove')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a draft: it is sent to the depot owners (one click)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return view(await this.bills.approve(id, user.sub));
  }

  @ApiOkResponse({ type: PartnerBillResponseDto })
  @Can('partnerBillApprove')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post(':id/paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a sent bill paid (the day the money arrived and a reference); a second call changes nothing' })
  async paid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return view(await this.bills.markPaid(id, dto.paidOn, dto.ref || null, user.sub));
  }

  @ApiOkResponse({ type: PartnerBillResponseDto })
  @Can('partnerBillApprove')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw a draft or a sent bill, with a reason; the month may be generated again' })
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidBillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return view(await this.bills.void(id, dto.reason, user.sub));
  }
}

/**
 * HD-23 - the n8n machine account's trigger for the monthly drafts (AI-25). Only a `machine` token
 * with `partnerBillGenerate` in its scopes is admitted; the call is written to the audit trail
 * before it runs and refused when it cannot be. It answers counts only: the amounts are
 * hydromart's, shown on /hq/partner-bills, and never travel through n8n.
 */
@ApiTags('Partner bills')
@ApiBearerAuth()
@Controller({ path: 'external/partner-bills', version: '1' })
export class PartnerBillExternalController {
  constructor(private readonly bills: PartnerBillService) {}

  @ExternalAccess('machine')
  @Can('partnerBillGenerate')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'n8n: make the drafts of a closed month (HD-23)' })
  @ApiOkResponse({ type: GenerateBillsResponseDto })
  generate(@Body() dto: GenerateBillsDto): Promise<GenerateResult> {
    return this.bills.generate(dto.month);
  }

  /**
   * HD-25: the sent, unpaid bills for the AI web's invoice reminders. Read-only; the call is audited
   * like every machine call. Depot codes only: no owner names, phones or account numbers.
   */
  @ExternalAccess('machine')
  @Can('partnerBillRemind')
  @UseInterceptors(AuditMutationsInterceptor)
  @Get('open')
  @ApiOperation({ summary: 'AI web: sent bills not yet paid, newest first (HD-25)' })
  @ApiOkResponse({ type: OpenBillResponseDto, isArray: true })
  open(): Promise<OpenBill[]> {
    return this.bills.open();
  }
}
