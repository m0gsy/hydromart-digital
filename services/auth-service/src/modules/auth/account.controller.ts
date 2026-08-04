import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { AccountService } from '../../application/services/account.service';
import { DataSubjectService } from '../../application/services/data-subject.service';
import { TokenService } from '../../application/services/token.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Can, ImportSummary, Role as PlatformRole, Roles, isDepotLocked } from '@hydromart/platform';
import { Role } from '../../domain/customer/role.enum';

import { getRequestContext } from '../../common/http/request-context';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { CustomerLookupDto } from './dto/customer-lookup.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import {
  ImportStaffDto,
  InviteStaffDto,
  ListStaffQueryDto,
  SetStaffActiveConsoleDto,
  SetStaffDepotDto,
} from './dto/staff.dto';
import {
  MessageResponseDto,
  PublicCustomerDto,
  SessionInfoDto,
} from './dto/responses.dto';

@ApiTags('Account')
@ApiBearerAuth()
@Controller({ version: '1' })
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly tokens: TokenService,
    // Deleting a staff account runs the same anonymisation the PDP queue does; the trigger
    // differs, the machinery must not.
    private readonly dataSubject: DataSubjectService,
  ) {}

  @Get('auth/me')
  @ApiOperation({ summary: 'Get the currently authenticated account' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<PublicCustomerDto> {
    const profile = await this.account.getProfile(user.sub);
    return PublicCustomerDto.withCapabilities(profile);
  }

  @Patch('auth/me')
  @ApiOperation({ summary: 'Update the authenticated account (name, email)' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAccountDto,
  ): Promise<PublicCustomerDto> {
    const profile = await this.account.updateProfile(user.sub, {
      fullName: dto.fullName,
      email: dto.email,
    });
    return PublicCustomerDto.from(profile);
  }

  // Staff-only: resolve a phone to a customer id for voucher grant. Mirrors the
  // promo-service voucher-write roles (marketing / depot-manager / super-admin).
  //
  // HR is here for a different reason: adding an employee promotes the account behind that
  // phone if one exists, so one mistyped digit turns a customer into a KEPALA_DEPOT. HR has
  // to be able to see whose number they typed BEFORE they save it.
  @Roles(Role.MARKETING, Role.MANAGER, Role.SUPER_ADMIN, Role.HR)
  @Get('auth/customers/lookup')
  @ApiOperation({ summary: 'Staff: look up a customer by exact phone (for voucher grant)' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async lookupByPhone(@Query() query: CustomerLookupDto): Promise<PublicCustomerDto> {
    const customer = await this.account.lookupByPhone(query.phone);
    return PublicCustomerDto.from(customer);
  }

  // Staff-only: resolve a batch of customer ids to names (reseller console row labels).
  // Same staff scope as the reseller registry it feeds (HQ + depot-manager).
  @Roles(Role.HEAD_OFFICE, Role.MANAGER, Role.SUPER_ADMIN)
  @Get('auth/customers/by-ids')
  @ApiOperation({ summary: 'Staff: resolve customer ids to public profiles (comma-separated)' })
  @ApiOkResponse({ type: PublicCustomerDto, isArray: true })
  async lookupByIds(@Query('ids') ids?: string): Promise<PublicCustomerDto[]> {
    const list = (ids ?? '').split(',').map((s) => s.trim());
    const customers = await this.account.lookupByIds(list);
    return customers.map(PublicCustomerDto.from);
  }

  // Staff & roles directory (PRD Module 7). Managing who has which role is a
  // head-office / super-admin responsibility; mirrored client-side in roles.ts.
  @Can('staffDirectory')
  @Get('auth/staff')
  @ApiOperation({ summary: 'List staff accounts (paginated, optional role filter)' })
  async listStaff(
    @Query() query: ListStaffQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    items: PublicCustomerDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const depotId = await this.scopedDepotFilter(user, query.depotId);
    const result = await this.account.listStaff(
      query.page ?? 1,
      query.limit ?? 20,
      query.role,
      depotId,
      query.search,
    );
    return { ...result, items: result.items.map(PublicCustomerDto.from) };
  }

  /**
   * The depot a staff-facing list must be narrowed to, decided from the CALLER.
   *
   * - depot-locked roles (kepala depot, depot staff) and depot managers: their own depot.
   *   Read from the ACCOUNT, not the token: a depot assigned after sign-in is not in the
   *   claim yet, and an account with no depot must deny rather than widen to the network.
   * - everyone else (HQ, direktur, super admin): whatever they asked for, or all.
   */
  private async scopedDepotFilter(
    user: AuthenticatedUser,
    requested?: string,
  ): Promise<string | undefined> {
    const ownDepotOnly =
      isDepotLocked(user.role as unknown as PlatformRole) || user.role === Role.MANAGER;
    if (!ownDepotOnly) {
      return requested;
    }
    const self = await this.account.getProfile(user.sub);
    if (!self.assignedDepotId || (requested && requested !== self.assignedDepotId)) {
      throw new ForbiddenException('Akun ini hanya boleh melihat staf depot yang ditugaskan padanya.');
    }
    return self.assignedDepotId;
  }

  // Driver roster for dispatch (feature 9b): pick a courier by name. Unlike the
  // staff directory above (head-office / super-admin only), dispatchers must be
  // able to read this, so it also allows the depot dispatch roles.
  @Can('driverRoster')
  @Get('auth/drivers')
  @ApiOperation({ summary: 'List active drivers (couriers) for dispatch, scoped to the caller' })
  @ApiOkResponse({ type: PublicCustomerDto, isArray: true })
  async listDrivers(
    @Query() query: { depotId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PublicCustomerDto[]> {
    const drivers = await this.account.listDrivers(await this.scopedDepotFilter(user, query.depotId));
    return drivers.map(PublicCustomerDto.from);
  }

  // HQ overview KPI (feature: new-customers tile): count of end-customer signups
  // in an optional [from, to) ISO window. Head-office / super-admin only.
  @Can('staffAdmin')
  @Get('auth/customers/count')
  @ApiOperation({ summary: 'HQ: count new customer signups in an optional date window' })
  async countCustomers(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ count: number; from: string | null; to: string | null }> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const count = await this.account.countNewCustomers(
      fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined,
      toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined,
    );
    return { count, from: from ?? null, to: to ?? null };
  }

  @Can('staffAdmin')
  @Post('auth/staff/invite')
  @ApiOperation({ summary: 'Invite (create) or promote an account to a staff role' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async inviteStaff(@Body() dto: InviteStaffDto): Promise<PublicCustomerDto> {
    // The console path: account AND employee record. See inviteStaffWithEmployee for why
    // the internal (hr-service) route deliberately does not come through here.
    const staff = await this.account.inviteStaffWithEmployee(dto);
    return PublicCustomerDto.from(staff);
  }

  /**
   * Move a staff account to another depot. Separate from the invite: re-inviting the same
   * phone was the only way to do this, and it carried a role and a reactivation with it.
   */
  @Can('staffAdmin')
  @Patch('auth/staff/:id/depot')
  @ApiOperation({ summary: "Move a staff account to another depot" })
  @ApiOkResponse({ type: PublicCustomerDto })
  async setStaffDepot(
    @Param('id') id: string,
    @Body() dto: SetStaffDepotDto,
  ): Promise<PublicCustomerDto> {
    const staff = await this.account.setStaffDepot(id, dto.depotId ?? null);
    return PublicCustomerDto.from(staff);
  }

  /**
   * Switch a staff login off or back on from the console — and carry it to their employee
   * record. The console had no way to do this at all, which is what made the other
   * direction (hr-service reporting a resignation) the only one that ever fired.
   */
  @Can('staffAdmin')
  @Patch('auth/staff/:id/status')
  @ApiOperation({ summary: 'Enable or disable a staff login (and their employee record)' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async setStaffActive(
    @Param('id') id: string,
    @Body() dto: SetStaffActiveConsoleDto,
  ): Promise<PublicCustomerDto> {
    const staff = await this.account.setStaffActive(id, dto.active);
    return PublicCustomerDto.from(staff);
  }

  /**
   * Delete a staff account: anonymise the identity everywhere and close the login for good.
   *
   * `staffDelete` (SUPER_ADMIN), not `staffAdmin`: head office may invite, and a mistaken
   * invite is one click from being fixed. This one is not undoable.
   */
  @Can('staffDelete')
  @Delete('auth/staff/:id')
  @ApiOperation({ summary: 'Delete (anonymise) a staff account — irreversible' })
  async deleteStaff(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: true }> {
    return this.dataSubject.deleteStaffAccount(id, user.sub);
  }

  @Can('staffAdmin')
  @Post('auth/staff/import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk-invite staff accounts from the HQ spreadsheet wizard',
    description:
      'One row per account, validated exactly like the single invite. A row that fails stops only itself; a phone that already has an account is promoted and reported as updated.',
  })
  async importStaff(@Body() dto: ImportStaffDto): Promise<ImportSummary> {
    return this.account.importStaff(dto.rows);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List active device sessions' })
  @ApiOkResponse({ type: SessionInfoDto, isArray: true })
  async sessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionInfoDto[]> {
    const sessions = await this.account.listSessions(user.sub);
    return sessions.map((session) => SessionInfoDto.from(session));
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke one of your own active device sessions by id' })
  @ApiOkResponse({ type: MessageResponseDto })
  async revokeSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    const ok = await this.account.revokeSession(user.sub, id);
    if (!ok) throw new NotFoundException('Session not found.');
    return { message: 'Session revoked.' };
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out of the current session (revoke a refresh token)' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(
    @Body() dto: RefreshTokenDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    await this.tokens.logout({
      refreshToken: dto.refreshToken,
      actorCustomerId: user.sub,
      context: getRequestContext(req),
    });
    return { message: 'Signed out.' };
  }

  @Post('auth/logout/all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out of every device (revoke all sessions)' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    await this.account.logoutAll(user.sub, getRequestContext(req));
    return { message: 'Signed out of all devices.' };
  }
}
