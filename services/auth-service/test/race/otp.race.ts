import { randomUUID } from 'node:crypto';

import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { OtpTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/otp-token.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('OTP resend on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: OtpTokenPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new OtpTokenPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  it('eight simultaneous resends: one code is stored, the rest are told to wait', async () => {
    for (let i = 0; i < 5; i++) {
      const customer = await prisma.customer.create({
        data: { phone: `+62${Math.floor(Math.random() * 1e10)}` },
      });
      const now = new Date();
      const res = await race(
        Array.from({ length: 8 }, () => () =>
          repo.issueExclusive(
            {
              customerId: customer.id,
              purpose: OtpPurpose.LOGIN,
              codeHash: randomUUID(),
              expiresAt: new Date(now.getTime() + 300_000),
            },
            60,
            now,
          ),
        ),
      );
      const outs = res.map((r) => (r as PromiseFulfilledResult<Record<string, unknown>>).value);
      expect(outs.filter((o) => 'token' in o)).toHaveLength(1);
      expect(outs.filter((o) => 'cooldownRemaining' in o)).toHaveLength(7);
      expect(
        await prisma.otpToken.count({ where: { customerId: customer.id, consumedAt: null } }),
      ).toBe(1);
    }
  });
});
