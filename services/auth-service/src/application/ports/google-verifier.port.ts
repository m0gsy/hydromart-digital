export interface GoogleIdentity {
  /** Stable Google account subject id. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Verifies a Google Sign-In ID token against the configured client id and returns
 * the identity. Throws InvalidGoogleTokenError when the token is not valid.
 */
export interface GoogleVerifierPort {
  verify(idToken: string): Promise<GoogleIdentity>;
}
