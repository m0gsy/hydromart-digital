import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { AccountService } from '../../application/services/account.service';
import { TokenService } from '../../application/services/token.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { getRequestContext } from '../../common/http/request-context';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
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
