import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';

import { CryptoPort } from '../../application/ports/crypto.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * Cryptographic primitives for the auth-service.
 *
 * - Low-entropy secrets (OTP codes) use bcrypt (slow, salted) so they resist
 *   brute-force even if the database leaks.
 * - High-entropy opaque tokens (refresh tokens) use a keyed HMAC-SHA256 so they can
 *   be looked up by hash while remaining useless without the server secret.
 */
@Injectable()
export class CryptoService implements CryptoPort {
  private static readonly BCRYPT_ROUNDS = 10;

  constructor(private readonly config: AuthConfigService) {}

  generateNumericCode(length: number): string {
    let code = '';
    for (let i = 0; i < length; i += 1) {
      code += randomInt(0, 10).toString();
    }
    return code;
  }

  generateOpaqueToken(): string {
    return randomBytes(48).toString('base64url');
  }

  hashSecret(value: string): Promise<string> {
    return hash(value, CryptoService.BCRYPT_ROUNDS);
  }

  verifySecret(value: string, hashed: string): Promise<boolean> {
    return compare(value, hashed);
  }

  hashToken(value: string): string {
    return createHmac('sha256', this.config.tokenPolicy.refreshSecret).update(value).digest('hex');
  }

  uuid(): string {
    return randomUUID();
  }
}
