import { randomUUID } from 'node:crypto';

import { ExpenseClaimPrismaRepository } from '../../src/infrastructure/prisma/expense-claim.prisma.repository';
import { PayoutBankAccountPrismaRepository } from '../../src/infrastructure/prisma/bank-account.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('payout on real Postgres — concurrent writers', () => {
  let drop: () => Promise<void>;
  let claims: ExpenseClaimPrismaRepository;
  let accounts: PayoutBankAccountPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    claims = new ExpenseClaimPrismaRepository(db.prisma as never);
    accounts = new PayoutBankAccountPrismaRepository(db.prisma as never);
  });
  afterAll(async () => drop?.());

  const claim = (receiptUrl: string | null) => ({
    courierId: randomUUID(),
    depotId: null,
    category: 'FUEL' as never,
    amount: 25_000,
    description: 'bensin',
    receiptUrl,
    status: 'PENDING' as const,
  });

  it('sixty submits of one receipt, repeated: exactly one is ever told the receipt is fresh', async () => {
    // Repeated and wide on purpose: the window between "count" and "insert" is a few
    // milliseconds, so a single small round can slip through even with no lock at all.
    for (let round = 0; round < 5; round++) {
      const receipt = `https://storage.example/pod/${randomUUID()}.jpg`;

      const results = await race(
        Array.from({ length: 60 }, () => () => claims.createCheckingReceipt(claim(receipt), receipt)),
      );

      const out = results.map(
        (r) => (r as PromiseFulfilledResult<{ receiptAlreadyUsed: boolean }>).value,
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      // Exactly one is eligible for auto-approval; the rest go to a reviewer.
      expect(out.filter((o) => !o.receiptAlreadyUsed)).toHaveLength(1);
      expect(await claims.countByReceiptUrl(receipt)).toBe(60);
    }
  });

  it('different receipts do not wait on each other and are all fresh', async () => {
    const results = await race(
      Array.from({ length: 10 }, () => () => {
        const receipt = `https://storage.example/pod/${randomUUID()}.jpg`;
        return claims.createCheckingReceipt(claim(receipt), receipt);
      }),
    );

    const out = results.map((r) => (r as PromiseFulfilledResult<{ receiptAlreadyUsed: boolean }>).value);
    expect(out.every((o) => !o.receiptAlreadyUsed)).toBe(true);
  });

  it('a verify of the account that was shown loses to the owner replacing it', async () => {
    for (let i = 0; i < 15; i++) {
      const subjectId = randomUUID();
      const shown = await accounts.upsert({
        subjectId,
        subjectType: 'OWNER',
        bankName: 'BCA',
        accountNumber: '1111111111',
        accountHolder: 'Budi',
      });

      const [decided] = await race([
        () =>
          accounts.decide(
            shown.id,
            { status: 'VERIFIED', verifiedBy: randomUUID(), rejectedReason: null },
            shown.updatedAt,
          ),
        () =>
          accounts.upsert({
            subjectId,
            subjectType: 'OWNER',
            bankName: 'BNI',
            accountNumber: '2222222222',
            accountHolder: 'Budi',
          }),
      ]);

      const final = (await accounts.findById(shown.id))!;
      if ((decided as PromiseFulfilledResult<unknown>).value) {
        // Verify won: it verified the account that was shown, and the replacement
        // then reset it to PENDING with the new details.
        expect(final.accountNumber).toBe('2222222222');
        expect(final.status).toBe('PENDING');
      } else {
        // Replacement won first: the old verify must not have stuck to the new account.
        expect(final.accountNumber).toBe('2222222222');
        expect(final.status).toBe('PENDING');
      }
      // Either way, the NEW destination is never VERIFIED by a review of the old one.
      expect(final.status === 'VERIFIED' && final.accountNumber === '2222222222').toBe(false);
    }
  });
});
