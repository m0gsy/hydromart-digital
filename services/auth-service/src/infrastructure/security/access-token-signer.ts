import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  AccessTokenClaims,
  AccessTokenSignerPort,
  SignedAccessToken,
} from '../../application/ports/access-token-signer.port';
import { AuthConfigService } from '../../config/auth-config.service';

/** Signs JWT access tokens using the configured access secret and TTL. */
@Injectable()
export class AccessTokenSigner implements AccessTokenSignerPort {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AuthConfigService,
  ) {}

  async sign(claims: AccessTokenClaims): Promise<SignedAccessToken> {
    const { accessSecret, accessTtlSeconds } = this.config.tokenPolicy;
    const token = await this.jwt.signAsync(claims, {
      secret: accessSecret,
      expiresIn: accessTtlSeconds,
    });
    return { token, expiresIn: accessTtlSeconds };
  }
}
