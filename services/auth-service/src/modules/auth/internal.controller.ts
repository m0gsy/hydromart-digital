import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AccountService } from '../../application/services/account.service';
import { Public } from '../../common/decorators/public.decorator';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { PublicCustomerDto } from './dto/responses.dto';
import { PreRegisterCustomerDto, PreRegisterResultDto, ProvisionStaffDto } from './dto/internal.dto';

/**
 * Service-to-service account provisioning for bulk imports. hr-service creates the
 * staff account behind an employee row; customer-service pre-registers an imported
 * customer. Both are done server-side ON PURPOSE: the HR role holds `hrAdmin` but not
 * `staffAdmin`, and `inviteStaff` takes an arbitrary role — routing the call through
 * here with a fixed role allowlist (`ProvisionStaffDto`) keeps a CSV row from ever
 * minting a HEAD_OFFICE/SUPER_ADMIN account.
 *
 * @Public() bypasses the JWT guard; InternalAuthGuard (shared key) is then the sole,
 * fail-closed auth.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalAuthGuard)
@ApiSecurity('internal-key')
@Controller({ path: 'auth/internal', version: '1' })
export class InternalAccountController {
  constructor(private readonly account: AccountService) {}

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or promote a staff account (internal service auth)' })
  async provisionStaff(@Body() dto: ProvisionStaffDto): Promise<PublicCustomerDto> {
    const staff = await this.account.inviteStaff(dto.phone, dto.role, dto.fullName, dto.depotId);
    return PublicCustomerDto.from(staff);
  }

  @Post('customers/pre-register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Pre-register an imported customer as PENDING (internal service auth)' })
  preRegisterCustomer(@Body() dto: PreRegisterCustomerDto): Promise<PreRegisterResultDto> {
    return this.account.preRegisterCustomer(dto.phone, dto.fullName);
  }
}
