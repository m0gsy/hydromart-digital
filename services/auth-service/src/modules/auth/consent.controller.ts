import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ConsentService } from '../../application/services/consent.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '@hydromart/platform';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { Role } from '../../domain/customer/role.enum';
import {
  ConsentHistoryEntryDto,
  ConsentStateDto,
  SetConsentDto,
} from './dto/consent.dto';

/**
 * UU PDP tahap 2 — the customer's own consent record and the switch for the optional
 * parts of it. Mandatory purposes appear here too: hiding them would leave the customer
 * unable to see what they are held to.
 */
@ApiTags('PDP')
@ApiBearerAuth()
@Roles(Role.CUSTOMER)
@Controller({ path: 'account/consents', version: '1' })
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  @Get()
  @ApiOperation({ summary: 'Your current consent per purpose, and whether it can be withdrawn' })
  async state(@CurrentUser() user: AuthenticatedUser): Promise<ConsentStateDto[]> {
    return (await this.consents.stateFor(user.sub)).map(ConsentStateDto.from);
  }

  @Get('history')
  @ApiOperation({ summary: 'Every consent decision you have made, oldest first' })
  async history(@CurrentUser() user: AuthenticatedUser): Promise<ConsentHistoryEntryDto[]> {
    return (await this.consents.history(user.sub)).map(ConsentHistoryEntryDto.from);
  }

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
    return ConsentHistoryEntryDto.from(
      await this.consents.set(user.sub, dto.purpose, dto.granted),
    );
  }
}
