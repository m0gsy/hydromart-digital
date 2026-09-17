import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role } from '@hydromart/platform';

import { PayoutBankAccountService } from '../application/services/bank-account.service';
import { PayoutBankAccountRecord } from '../application/ports/bank-account.repository';
import { BankAccountResponseDto, RegisterBankAccountDto } from './dto/payout.dto';

/**
 * PYO-3 — the payout destination on file, for whoever is asking about their own.
 *
 * Its own controller because both sides of the money use it: a franchise owner cashing out
 * a balance and a courier cashing out earnings. `payout` (owner-only) and `courierPayout`
 * each gate one of those, so a route living under either would be closed to the other half.
 *
 * route-authz: self-scoped by `@CurrentUser()` — there is one account per person and nobody
 * reads anyone else's here. Head office reviews them through /payout/hq/bank-accounts.
 */
@ApiTags('Payout')
@ApiBearerAuth()
@Controller({ path: 'payout/bank-account', version: '1' })
export class PayoutBankAccountController {
  constructor(private readonly accounts: PayoutBankAccountService) {}

  @ApiOkResponse({ type: BankAccountResponseDto })
  @Get()
  @ApiOperation({ summary: 'The payout destination registered by the caller (null when none)' })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<PayoutBankAccountRecord | null> {
    return this.accounts.mine(user.sub);
  }

  /**
   * Registering again REPLACES the account and sends it back to head office for checking: a
   * new destination is a new destination, whatever the old one was verified as.
   */
  @ApiOkResponse({ type: BankAccountResponseDto })
  @Put()
  @ApiOperation({ summary: 'Register or replace the payout destination (goes back to PENDING)' })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterBankAccountDto,
  ): Promise<PayoutBankAccountRecord> {
    const subjectType = user.role === Role.FRANCHISE_OWNER ? 'OWNER' : 'COURIER';
    return this.accounts.register(user.sub, subjectType, dto);
  }
}
