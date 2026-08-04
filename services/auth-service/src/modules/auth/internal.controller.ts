import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AccountService } from '../../application/services/account.service';
import { AuditService } from '../../application/services/audit.service';
import { Public } from '../../common/decorators/public.decorator';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { PublicCustomerDto } from './dto/responses.dto';
import {
  AssignStaffRoleDto,
  LookupCustomerIdsDto,
  PreRegisterCustomerDto,
  PreRegisterResultDto,
  ProvisionManagedStaffDto,
  ProvisionStaffDto,
  PurgeBeforeDto,
} from './dto/internal.dto';

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
  constructor(
    private readonly account: AccountService,
    private readonly audit: AuditService,
  ) {}

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or promote a staff account (internal service auth)' })
  async provisionStaff(@Body() dto: ProvisionStaffDto): Promise<PublicCustomerDto> {
    const staff = await this.account.inviteStaff(dto.phone, dto.role, dto.fullName, dto.depotId);
    return PublicCustomerDto.from(staff);
  }

  /**
   * The same provisioning, for the single-employee HR form rather than an import file.
   *
   * A separate route rather than a wider `ProvisionStaffDto`: widening that one would have
   * handed the spreadsheet path the supervision roles too, and a file of a thousand rows
   * is exactly the place those must not be reachable from.
   */
  @Post('staff/managed')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or promote an HR-managed staff account (internal service auth)' })
  async provisionManagedStaff(@Body() dto: ProvisionManagedStaffDto): Promise<PublicCustomerDto> {
    const staff = await this.account.inviteStaff(dto.phone, dto.role, dto.fullName, dto.depotId);
    return PublicCustomerDto.from(staff);
  }

  // An HR jabatan change reaching the login. Same allowlist reasoning as `staff` above,
  // one rung wider (`HR_MANAGED_ROLES`) so a promotion up the supervision chain works
  // without leaving the person's old access in place.
  @Post('staff/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Change an existing staff account's role (internal service auth)" })
  async assignStaffRole(@Body() dto: AssignStaffRoleDto): Promise<PublicCustomerDto> {
    const staff = await this.account.setStaffRole(dto.customerId, dto.role, dto.depotId);
    return PublicCustomerDto.from(staff);
  }

  @Post('customers/pre-register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Pre-register an imported customer as PENDING (internal service auth)' })
  preRegisterCustomer(@Body() dto: PreRegisterCustomerDto): Promise<PreRegisterResultDto> {
    return this.account.preRegisterCustomer(dto.phone, dto.fullName);
  }

  /**
   * Name lookup for service-to-service callers. customer-service holds no name of its own
   * — its depot directory was reading the primary ADDRESS's recipientName, so a customer
   * with no primary address showed as "Tanpa nama". The account name lives here, so this
   * is where the directory asks for it.
   */
  @Post('customers/by-ids')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve customer ids to public profiles (internal service auth)' })
  async lookupByIds(@Body() dto: LookupCustomerIdsDto): Promise<PublicCustomerDto[]> {
    const customers = await this.account.lookupByIds(dto.ids);
    return customers.map(PublicCustomerDto.from);
  }

  /**
   * Retention enforcement: admin-service owns the policy, auth-service owns the rows.
   * The cutoff is passed in rather than recomputed here — one service decides what may
   * be deleted, and it is the one holding the compliance rule.
   */
  @Post('audit-logs/purge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete audit rows older than the cutoff (internal service auth)' })
  purgeAuditLogs(@Body() dto: PurgeBeforeDto): Promise<{ deleted: number }> {
    return this.audit.purgeOlderThan(new Date(dto.cutoff));
  }
}
