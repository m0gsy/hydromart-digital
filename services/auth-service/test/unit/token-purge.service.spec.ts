import { TokenPurgeService } from '../../src/application/services/token-purge.service';

describe('TokenPurgeService (AUT-08)', () => {
  const now = new Date('2026-11-08T00:00:00.000Z');
  const otp = { deleteExpiredBefore: jest.fn(async () => 7) };
  const refresh = { deleteExpiredBefore: jest.fn(async () => 3) };
  const service = new TokenPurgeService(otp as never, refresh as never, { now: () => now } as never);

  beforeEach(() => jest.clearAllMocks());

  it('deletes expired OTP challenges and refresh tokens before the cutoff and reports both counts', async () => {
    const cutoff = new Date('2026-10-01T00:00:00.000Z');
    await expect(service.purgeExpired(cutoff)).resolves.toEqual({ otpTokens: 7, refreshTokens: 3 });
    expect(otp.deleteExpiredBefore).toHaveBeenCalledWith(cutoff);
    expect(refresh.deleteExpiredBefore).toHaveBeenCalledWith(cutoff);
  });

  it('never reaches within a day of now, however late the caller says the cutoff is', async () => {
    await service.purgeExpired(new Date('2030-01-01T00:00:00.000Z'));
    const floor = new Date('2026-11-07T00:00:00.000Z');
    expect(otp.deleteExpiredBefore).toHaveBeenCalledWith(floor);
    expect(refresh.deleteExpiredBefore).toHaveBeenCalledWith(floor);
  });
});
