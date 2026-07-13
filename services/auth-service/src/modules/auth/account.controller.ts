import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { AccountService } from '../../application/services/account.service';
import { TokenService } from '../../application/services/token.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../domain/customer/role.enum';
import { getRequestContext } from '../../common/http/request-context';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { CustomerLookupDto } from './dto/customer-lookup.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { InviteStaffDto, ListStaffQueryDto } from './dto/staff.dto';
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
  ) {}

  @Get('auth/me')
  @ApiOperation({ summary: 'Get the currently authenticated account' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<PublicCustomerDto> {
    const profile = await this.account.getProfile(user.sub);
    return PublicCustomerDto.from(profile);
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
  @Roles(Role.MARKETING, Role.DEPOT_MANAGER, Role.SUPER_ADMIN)
  @Get('auth/customers/lookup')
  @ApiOperation({ summary: 'Staff: look up a customer by exact phone (for voucher grant)' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async lookupByPhone(@Query() query: CustomerLookupDto): Promise<PublicCustomerDto> {
    const customer = await this.account.lookupByPhone(query.phone);
    return PublicCustomerDto.from(customer);
  }

  // Staff & roles directory (PRD Module 7). Managing who has which role is a
  // head-office / super-admin responsibility; mirrored client-side in roles.ts.
  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Get('auth/staff')
  @ApiOperation({ summary: 'List staff accounts (paginated, optional role filter)' })
  async listStaff(@Query() query: ListStaffQueryDto): Promise<{
    items: PublicCustomerDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = await this.account.listStaff(query.page ?? 1, query.limit ?? 20, query.role);
    return { ...result, items: result.items.map(PublicCustomerDto.from) };
  }

  // Driver roster for dispatch (feature 9b): pick a courier by name. Unlike the
  // staff directory above (head-office / super-admin only), dispatchers must be
  // able to read this, so it also allows the depot dispatch roles.
  @Roles(Role.DEPOT_OPERATOR, Role.DEPOT_MANAGER, Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Get('auth/drivers')
  @ApiOperation({ summary: 'List active drivers (couriers) for dispatch' })
  @ApiOkResponse({ type: PublicCustomerDto, isArray: true })
  async listDrivers(): Promise<PublicCustomerDto[]> {
    const drivers = await this.account.listDrivers();
    return drivers.map(PublicCustomerDto.from);
  }

  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Post('auth/staff/invite')
  @ApiOperation({ summary: 'Invite (create) or promote an account to a staff role' })
  @ApiOkResponse({ type: PublicCustomerDto })
  async inviteStaff(@Body() dto: InviteStaffDto): Promise<PublicCustomerDto> {
    const staff = await this.account.inviteStaff(dto.phone, dto.role, dto.fullName);
    return PublicCustomerDto.from(staff);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List active device sessions' })
  @ApiOkResponse({ type: SessionInfoDto, isArray: true })
  async sessions(@CurrentUser() user: AuthenticatedUser): Promise<SessionInfoDto[]> {
    const sessions = await this.account.listSessions(user.sub);
    return sessions.map((session) => SessionInfoDto.from(session));
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
