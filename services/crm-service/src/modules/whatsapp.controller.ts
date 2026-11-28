import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
  SelfScoped,
  assertDepotAccess,
} from '@hydromart/platform';

import { CrmConfigService } from '../config/crm-config.service';
import { ContactState, WhatsappConsentService } from '../application/services/whatsapp-consent.service';
import { WaOverview, WhatsappAdminService } from '../application/services/whatsapp-admin.service';
import {
  ContactStateDto,
  CreateCashierCodeDto,
  PauseWaDto,
  SetWaCapDto,
  SetWaTemplateStatusDto,
} from './dto/whatsapp.dto';
import { WaReadyGuard } from './whatsapp.guards';

/**
 * HD-12/HD-13: WhatsApp number 1 for people. The customer's and the cashier's routes answer 404 while the
 * channel is off, so the apps (which ask /status first) show nothing. HQ's routes are staff screens over
 * data: they answer while off too, because caps and template states are entered BEFORE the owner switches
 * the channel on; nothing here sends a message or calls Meta.
 */
@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappController {
  constructor(
    private readonly config: CrmConfigService,
    private readonly consent: WhatsappConsentService,
    private readonly admin: WhatsappAdminService,
  ) {}

  /*
   * route-authz: takes no subject. Any signed-in account may ask whether WhatsApp is on; the answer is the
   * same for everyone and holds nothing about anybody.
   */
  @ApiOkResponse({ description: 'Whether WhatsApp number 1 is on: { enabled }.' })
  @SelfScoped()
  @Get('status')
  @ApiOperation({ summary: 'Is WhatsApp number 1 on? The apps hide every WhatsApp screen when it is not.' })
  status(): { enabled: boolean } {
    return { enabled: this.config.whatsapp.ready };
  }

  /** The customer's own code: they open a chat to number 1 with it and press send. */
  @ApiOkResponse({ description: 'The code, its expiry and the wa.me link to open.' })
  @SelfScoped()
  @UseGuards(WaReadyGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('opt-in/code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make a 30-minute WhatsApp opt-in code for the signed-in customer' })
  selfCode(@CurrentUser() user: AuthenticatedUser) {
    return this.consent.createCode({ kind: 'SELF', createdBy: user.sub, customerId: user.sub, depotId: null });
  }

  /** The cashier's code for a customer standing at the counter (a walk-in has no account). */
  @ApiOkResponse({ description: 'The code, its expiry and the wa.me link to draw as a QR.' })
  @Can('waOptInIssue')
  @UseGuards(WaReadyGuard)
  @Post('opt-in/codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make an opt-in code the cashier shows as a QR (own depot)' })
  cashierCode(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCashierCodeDto) {
    return this.consent.createCode({
      kind: 'CASHIER',
      createdBy: user.sub,
      customerId: dto.customerId ?? null,
      depotId: dto.depotId,
    });
  }

  @ApiOkResponse({ description: 'WAITING, USED or EXPIRED.' })
  @Can('waOptInIssue')
  @UseGuards(WaReadyGuard)
  @Get('opt-in/codes/:id')
  @ApiOperation({ summary: 'Has the customer used this code yet? (the counter polls it)' })
  async codeState(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    // Only the cashier who made the code sees it (the service), and only within their depot (here).
    const { state, depotId } = await this.consent.codeState(id, user.sub);
    assertDepotAccess(user, depotId);
    return { state };
  }

  @ApiOkResponse({ description: 'The customer WhatsApp state and the masked number.' })
  @SelfScoped()
  @UseGuards(WaReadyGuard)
  @Get('me')
  @ApiOperation({ summary: "The signed-in customer's WhatsApp state (number masked)" })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.consent.me(user.sub);
  }

  @ApiOkResponse({ description: 'Whether anything was withdrawn.' })
  @SelfScoped()
  @UseGuards(WaReadyGuard)
  @Post('me/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The customer withdraws WhatsApp notifications in the app' })
  revoke(@CurrentUser() user: AuthenticatedUser) {
    return this.consent.revoke(user.sub);
  }

  /** The depot CRM follow-up list: may this number be messaged? NONE for all while the channel is off. */
  @ApiOkResponse({ description: 'Per number: OPTED_IN, STOPPED or NONE.' })
  @Can('depotCrm')
  @Post('contact-state')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'OPTED_IN / STOPPED / NONE for up to 200 numbers (depot CRM)' })
  contactState(@Body() dto: ContactStateDto): Promise<Record<string, ContactState>> {
    return this.consent.contactStates(dto.phones);
  }

  @ApiOkResponse({ description: 'State, caps, month counters, templates and the last refusals.' })
  @Can('waCostRead')
  @Get('hq/overview')
  @ApiOperation({ summary: 'State, caps, month counters, templates and the last refusals (HQ)' })
  overview(): Promise<WaOverview> {
    return this.admin.overview();
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('waManage')
  @UseInterceptors(AuditMutationsInterceptor)
  @Put('hq/caps/:category')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set the monthly cap and rate of one category (HQ)' })
  async setCap(
    @CurrentUser() user: AuthenticatedUser,
    @Param('category') category: string,
    @Body() dto: SetWaCapDto,
  ): Promise<void> {
    await this.admin.setCap(
      category,
      { monthlyMessages: dto.monthlyMessages, rateIdr: dto.rateIdr ?? null, monthlyCostIdr: dto.monthlyCostIdr ?? null },
      user.sub,
    );
  }

  /** The kill switch: pauses (or resumes) every cap row of number 1 at once. */
  @ApiOkResponse({ description: 'How many cap rows were paused or resumed.' })
  @Can('waManage')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('hq/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause or resume all WhatsApp sending (HQ kill switch)' })
  async pause(@CurrentUser() user: AuthenticatedUser, @Body() dto: PauseWaDto): Promise<{ rows: number }> {
    return { rows: await this.admin.setPaused(dto.paused, user.sub) };
  }

  @ApiOkResponse({ description: 'Whether a template row was updated.' })
  @Can('waManage')
  @UseInterceptors(AuditMutationsInterceptor)
  @Put('hq/templates')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark a template's approval state by hand (HQ)" })
  async templateStatus(@Body() dto: SetWaTemplateStatusDto): Promise<{ updated: boolean }> {
    return { updated: await this.admin.setTemplateStatus(dto.name, dto.language, dto.status, dto.reason ?? null) };
  }
}
