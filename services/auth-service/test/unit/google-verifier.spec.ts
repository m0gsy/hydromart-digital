import { OAuth2Client } from 'google-auth-library';

import { InvalidGoogleTokenError } from '../../src/domain/errors/auth.errors';
import { GoogleVerifier } from '../../src/infrastructure/security/google-verifier';
import { buildTestConfig } from '../support/fakes';

describe('GoogleVerifier', () => {
  afterEach(() => jest.restoreAllMocks());

  it('throws when Google Sign-In is not configured', async () => {
    const verifier = new GoogleVerifier(buildTestConfig());
    await expect(verifier.verify('token')).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('returns the identity for a valid token', async () => {
    jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'google-1',
        email: 'budi@x.com',
        email_verified: true,
        name: 'Budi',
      }),
    } as never);

    const verifier = new GoogleVerifier(buildTestConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-1' }));
    const identity = await verifier.verify('valid.token');

    expect(identity).toEqual({
      sub: 'google-1',
      email: 'budi@x.com',
      emailVerified: true,
      name: 'Budi',
    });
  });

  it('maps verification failure to a domain error', async () => {
    jest
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockRejectedValue(new Error('invalid signature') as never);

    const verifier = new GoogleVerifier(buildTestConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-1' }));
    await expect(verifier.verify('bad.token')).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('rejects a token whose payload has no subject', async () => {
    jest
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockResolvedValue({ getPayload: () => undefined } as never);

    const verifier = new GoogleVerifier(buildTestConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-1' }));
    await expect(verifier.verify('token')).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });
});
