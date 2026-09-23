import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TOKEN_ALGORITHM, TOKEN_AUDIENCE, TOKEN_ISSUER } from '@hydromart/platform';

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
      // AUTH-5: say who minted it, what it is for, and how it is signed — and pin the
      // algorithm so a token cannot tell the verifier how to check it.
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      algorithm: TOKEN_ALGORITHM,
    });
    return { token, expiresIn: accessTtlSeconds };
  }
}
