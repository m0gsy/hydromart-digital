import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Can, SelfScoped } from '@hydromart/platform';
import { Request } from 'express';

import { OtpChallengeResult } from '../../application/results';
import { TotpService, TotpStatus } from '../../application/services/totp.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { getRequestContext } from '../../common/http/request-context';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import {
  TotpConfirmDto,
  TotpEnrolmentDto,
  TotpRecoveryCodesDto,
  TotpResetDto,
  TotpStatusDto,
} from './dto/totp.dto';

/**
 * HD-4: the authenticator app behind the AI-web sign-in. A person sets theirs up from their
 * own hydromart-digital session; the handoff exchange checks it (external-access.controller).
 */
@ApiTags('Authenticator (TOTP)')
@Controller({ path: 'auth/totp', version: '1' })
export class TotpController {
  constructor(private readonly totp: TotpService) {}

  @SelfScoped()
  @Get()
  @ApiOperation({ summary: 'Whether my authenticator is set up, required, or locked' })
  @ApiOkResponse({ type: TotpStatusDto })
  status(@CurrentUser() user: AuthenticatedUser): Promise<TotpStatus> {
    return this.totp.status(user);
  }

  @SelfScoped()
  @Post('enrolment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start setting up my authenticator: a new secret shown once, and an SMS code' })
  @ApiOkResponse({ type: TotpEnrolmentDto })
  startEnrolment(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ secret: string; otpauthUri: string; sms: OtpChallengeResult }> {
    return this.totp.startEnrolment(user, getRequestContext(req));
  }

  @SelfScoped()
  @Post('enrolment/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm with the first app code and the SMS code; recovery codes once' })
  @ApiOkResponse({ type: TotpRecoveryCodesDto })
  confirmEnrolment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TotpConfirmDto,
    @Req() req: Request,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.totp.confirmEnrolment(user, dto.code, dto.smsCode, getRequestContext(req));
  }

  /** Only SUPER_ADMIN holds accessMatrixWrite; the service also refuses their own account. */
  @Can('accessMatrixWrite')
  @Delete(':customerId')
  @ApiOperation({ summary: "Reset another person's authenticator (SUPER_ADMIN)" })
  @ApiOkResponse({ type: TotpResetDto })
  reset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Req() req: Request,
  ): Promise<{ removed: boolean }> {
    return this.totp.reset(user, customerId, getRequestContext(req));
  }
}
