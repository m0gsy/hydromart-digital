import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SelfScoped } from '@hydromart/platform';
import { Request } from 'express';

import {
  ExternalAccessService,
  ExternalTokenResult,
} from '../../application/services/external-access.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { getRequestContext } from '../../common/http/request-context';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user';
import { PublicJwk } from '../../config/external-access';
import { ExternalTokenSigner } from '../../infrastructure/security/external-token-signer';
import {
  ExternalTokenResponseDto,
  HandoffCodeDto,
  HandoffCodeResponseDto,
  HandoffTokenDto,
  JwksResponseDto,
  MachineTokenDto,
} from './dto/external-access.dto';

/**
 * HD-3: where the AI web and machine accounts get their ES256 tokens, and where every
 * service reads the keys that verify them (HD-2, packages/platform external-access.ts).
 * The contract the AI web codes against is contracts/ai-v1/auth.openapi.json.
 */
@ApiTags('External access')
@Controller({ path: 'auth', version: '1' })
export class ExternalAccessController {
  constructor(
    private readonly external: ExternalAccessService,
    private readonly signer: ExternalTokenSigner,
  ) {}

  /** Public keys, by `kid`. Empty when switched off; services re-read it every 30 s. */
  @Public()
  @Get('jwks')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Public keys that verify AI-web and machine tokens (JWKS)' })
  @ApiOkResponse({ type: JwksResponseDto })
  jwks(): { keys: PublicJwk[] } {
    return this.signer.jwks();
  }

  /** A signed-in staff member asks for a one-time code bound to the AI web's PKCE challenge. */
  @SelfScoped()
  @Post('handoff/code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a 60-second handoff code for the AI web (PKCE S256)' })
  @ApiOkResponse({ type: HandoffCodeResponseDto })
  handoffCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: HandoffCodeDto,
    @Req() req: Request,
  ): Promise<{ code: string; expiresIn: number }> {
    return this.external.issueHandoffCode(user, dto.codeChallenge, getRequestContext(req));
  }

  /** The AI web's server trades the code and its verifier for a 15-minute token. */
  @Public()
  @Post('handoff/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a handoff code + PKCE verifier for an AI-web token' })
  @ApiOkResponse({ type: ExternalTokenResponseDto })
  handoffToken(@Body() dto: HandoffTokenDto, @Req() req: Request): Promise<ExternalTokenResult> {
    return this.external.exchangeHandoffCode(dto.code, dto.codeVerifier, getRequestContext(req), {
      totp: dto.totp,
      recoveryCode: dto.recoveryCode,
      ticket: dto.secondFactorTicket,
    });
  }

  /** A machine account (n8n) trades its id and secret for a 15-minute token. */
  @Public()
  @Post('machine/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a machine-account token carrying its closed scopes' })
  @ApiOkResponse({ type: ExternalTokenResponseDto })
  machineToken(@Body() dto: MachineTokenDto, @Req() req: Request): Promise<ExternalTokenResult> {
    return this.external.issueMachineToken(dto.accountId, dto.secret, getRequestContext(req));
  }
}
