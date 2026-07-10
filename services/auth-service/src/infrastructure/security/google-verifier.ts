import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

import { InvalidGoogleTokenError } from '../../domain/errors/auth.errors';
import { GoogleIdentity, GoogleVerifierPort } from '../../application/ports/google-verifier.port';
import { AuthConfigService } from '../../config/auth-config.service';

/** Verifies Google Sign-In ID tokens against the configured OAuth client id (FR-006). */
@Injectable()
export class GoogleVerifier implements GoogleVerifierPort {
  private readonly logger = new Logger(GoogleVerifier.name);
  private readonly client = new OAuth2Client();

  constructor(private readonly config: AuthConfigService) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    const clientId = this.config.googleClientId;
    if (!clientId) {
      throw new InvalidGoogleTokenError('Google Sign-In is not configured.');
    }

    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload?.sub) {
        throw new InvalidGoogleTokenError();
      }
      return {
        sub: payload.sub,
        email: payload.email ?? null,
        emailVerified: payload.email_verified ?? false,
        name: payload.name ?? null,
      };
    } catch (error) {
      if (error instanceof InvalidGoogleTokenError) {
        throw error;
      }
      this.logger.warn(`Google ID token verification failed: ${(error as Error).message}`);
      throw new InvalidGoogleTokenError();
    }
  }
}
