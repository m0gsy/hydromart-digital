import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { LoginService } from '../../application/services/login.service';
import { OtpVerificationService } from '../../application/services/otp-verification.service';
import { RegistrationService } from '../../application/services/registration.service';
import { TokenService } from '../../application/services/token.service';
import { getRequestContext } from '../../common/http/request-context';
import { Public } from '../../common/decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpChallengeResponseDto, SessionResponseDto } from './dto/responses.dto';

@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly otpVerification: OtpVerificationService,
    private readonly loginService: LoginService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register with a phone number and receive a verification code' })
  @ApiOkResponse({ type: OtpChallengeResponseDto })
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<OtpChallengeResponseDto> {
    const result = await this.registration.register({
      phone: dto.phone,
      fullName: dto.fullName,
      email: dto.email,
      context: getRequestContext(req),
    });
    return OtpChallengeResponseDto.from(result);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an OTP and receive an authenticated session' })
  @ApiOkResponse({ type: SessionResponseDto })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request): Promise<SessionResponseDto> {
    const session = await this.otpVerification.verify({
      phone: dto.phone,
      code: dto.code,
      purpose: dto.purpose,
      context: getRequestContext(req),
    });
    return SessionResponseDto.from(session);
  }

  @Public()
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the verification code (subject to a cooldown)' })
  @ApiOkResponse({ type: OtpChallengeResponseDto })
  async resendOtp(
    @Body() dto: ResendOtpDto,
    @Req() req: Request,
  ): Promise<OtpChallengeResponseDto> {
    const result = await this.otpVerification.resend({
      phone: dto.phone,
      purpose: dto.purpose,
      context: getRequestContext(req),
    });
    return OtpChallengeResponseDto.from(result);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a phone login by requesting an OTP' })
  @ApiOkResponse({ type: OtpChallengeResponseDto })
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<OtpChallengeResponseDto> {
    const result = await this.loginService.requestLogin({
      phone: dto.phone,
      context: getRequestContext(req),
    });
    return OtpChallengeResponseDto.from(result);
  }

  @Public()
  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token and receive a new session' })
  @ApiOkResponse({ type: SessionResponseDto })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<SessionResponseDto> {
    const session = await this.tokens.refresh({
      refreshToken: dto.refreshToken,
      context: getRequestContext(req),
    });
    return SessionResponseDto.from(session);
  }
}
