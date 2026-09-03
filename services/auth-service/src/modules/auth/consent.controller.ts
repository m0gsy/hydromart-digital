import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CONSENT_DOCUMENT_VERSION,
  ConsentService,
} from '../../application/services/consent.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Can, Roles } from '@hydromart/platform';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { Role } from '../../domain/customer/role.enum';
import {
  ConsentHistoryEntryDto,
  ConsentLagQueryDto,
  ConsentLagReportDto,
  ConsentPendingDto,
  ConsentStateDto,
  SetConsentDto,
} from './dto/consent.dto';

/**
 * UU PDP tahap 2 — the customer's own consent record and the switch for the optional
 * parts of it. Mandatory purposes appear here too: hiding them would leave the customer
 * unable to see what they are held to.
 *
 * Authorisation is per method, not on the class, because two different audiences are
 * served from one resource — the same split `DataSubjectController` already makes, where
 * customers raise requests and head office reads the queue. `RolesGuard` resolves handler
 * first (see its `required()`), so nothing here is inherited by accident; a new method
 * with no decorator is refused by `scripts/check-route-authz.mjs`, not by silence.
 */
@ApiTags('PDP')
@ApiBearerAuth()
@Controller({ path: 'account/consents', version: '1' })
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  @ApiOkResponse({ type: ConsentStateDto, isArray: true })
  @Roles(Role.CUSTOMER)
  @Get()
  @ApiOperation({ summary: 'Your current consent per purpose, and whether it can be withdrawn' })
  async state(@CurrentUser() user: AuthenticatedUser): Promise<ConsentStateDto[]> {
    return (await this.consents.stateFor(user.sub)).map(ConsentStateDto.from);
  }

  /**
   * W10. The service could already work this out and nothing could ask it: no route
   * returned `pendingAcceptance`, so a client had no way to know the wording had moved on.
   *
   * The subject is `user.sub` and there is no path or query parameter for an id — this
   * question is only ever about the caller. The fleet-wide version of it is `report`
   * below, and it is a different capability on purpose.
   */
  @ApiOkResponse({ type: ConsentPendingDto })
  @Roles(Role.CUSTOMER)
  @Get('pending')
  @ApiOperation({
    summary: 'Whether you still have to accept the current Terms/Privacy text',
    description:
      'Reports only. A new version never revokes an earlier acceptance and nothing here ' +
      'blocks, downgrades or signs out an account — the response says so in `enforcement`. ' +
      'Confirm by PUT-ing each returned purpose with granted=true; the old row stays on ' +
      'file as evidence of what was agreed when.',
  })
  async pending(@CurrentUser() user: AuthenticatedUser): Promise<ConsentPendingDto> {
    return ConsentPendingDto.from(
      CONSENT_DOCUMENT_VERSION,
      await this.consents.pendingAcceptance(user.sub),
    );
  }

  /**
   * The fleet-wide half: how much of the customer base is behind the version in force.
   *
   * `pdpRequests` (head office / super admin), the same capability that decides an export
   * or a deletion — not `hqConsole`, which a director holds: this is a data-protection
   * question about identified accounts, and it belongs with the rest of the PDP desk.
   */
  @ApiOkResponse({ type: ConsentLagReportDto })
  @Can('pdpRequests')
  @Get('report')
  @ApiOperation({
    summary: 'Fleet-wide: how many accounts are behind the Terms/Privacy version in force',
    description:
      'Paginated by keyset, capped at 100 per page. Counts customer accounts only. ' +
      'Expect nearly the whole base in `outdated` on day one: every existing row was ' +
      "backfilled at version '1.0'. Distinguishes never-asked from refused; changes " +
      'nothing and prompts nobody.',
  })
  async report(@Query() query: ConsentLagQueryDto): Promise<ConsentLagReportDto> {
    return ConsentLagReportDto.from(
      await this.consents.fleetLag({ limit: query.limit, cursor: query.cursor }),
    );
  }

  @ApiOkResponse({ type: ConsentHistoryEntryDto, isArray: true })
  @Roles(Role.CUSTOMER)
  @Get('history')
  @ApiOperation({ summary: 'Every consent decision you have made, oldest first' })
  async history(@CurrentUser() user: AuthenticatedUser): Promise<ConsentHistoryEntryDto[]> {
    return (await this.consents.history(user.sub)).map(ConsentHistoryEntryDto.from);
  }

  @ApiOkResponse({ type: ConsentHistoryEntryDto })
  @Roles(Role.CUSTOMER)
  @Put()
  @ApiOperation({
    summary: 'Grant or withdraw one optional consent',
    description:
      'Withdrawing a mandatory purpose (TERMS/PRIVACY) is refused with 422 — that request is account deletion, which has its own queue.',
  })
  async set(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetConsentDto,
  ): Promise<ConsentHistoryEntryDto> {
    return ConsentHistoryEntryDto.from(await this.consents.set(user.sub, dto.purpose, dto.granted));
  }
}
