import { sign, type KeyObject } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EXTERNAL_TOKEN_ALGORITHM, TOKEN_ISSUER } from '@hydromart/platform';

import { AuthConfigService } from '../../config/auth-config.service';
import { parseSigningKey, publicJwk, type PublicJwk } from '../../config/external-access';

/** What an AI-web or machine token says beyond iss/iat/exp, per the HD-2 contract. */
export interface ExternalTokenClaims {
  aud: string;
  sub: string;
  role?: string;
  depotId?: string | null;
  scopes?: readonly string[];
}

const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * HD-3: signs the ES256 tokens HD-2 verifies, and publishes the keys to verify them with.
 * The private key never leaves this service; every other service reads the JWKS.
 *
 * With no signing key it signs nothing and publishes nothing, the previous key included:
 * that empty set is the kill switch, and a previous key left published would keep the
 * last tokens alive for their final fifteen minutes after it was thrown.
 */
@Injectable()
export class ExternalTokenSigner {
  private readonly key: KeyObject | null;
  private readonly kid: string | null;
  private readonly keys: PublicJwk[];

  constructor(config: AuthConfigService) {
    const { signing, previous } = config.externalTokenKeys;
    this.key = signing ? parseSigningKey(signing) : null;
    const current = this.key ? publicJwk(this.key) : null;
    this.kid = current?.kid ?? null;
    this.keys = current ? [current] : [];
    if (current && previous) {
      const old = publicJwk(parseSigningKey(previous));
      if (old.kid !== current.kid) this.keys.push(old);
    }
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  jwks(): { keys: PublicJwk[] } {
    return { keys: this.keys };
  }

  /** A compact JWS. Callers check `enabled` first; signing while off is a programming error. */
  sign(claims: ExternalTokenClaims, ttlSeconds: number, now: Date): string {
    if (!this.key || !this.kid) throw new Error('AI and machine tokens are switched off');
    const iat = Math.floor(now.getTime() / 1000);
    const head = part({ alg: EXTERNAL_TOKEN_ALGORITHM, typ: 'JWT', kid: this.kid });
    const body = part({ iss: TOKEN_ISSUER, ...claims, iat, exp: iat + ttlSeconds });
    // JWS wants r||s (64 bytes), not the DER signature Node gives by default.
    const signature = sign('sha256', Buffer.from(`${head}.${body}`), {
      key: this.key,
      dsaEncoding: 'ieee-p1363',
    });
    return `${head}.${body}.${signature.toString('base64url')}`;
  }
}
