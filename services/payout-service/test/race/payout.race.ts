import { randomUUID } from 'node:crypto';

import { WithdrawalPrismaRepository } from '../../src/infrastructure/prisma/withdrawal.prisma.repository';
import { LedgerPrismaRepository } from '../../src/infrastructure/prisma/ledger.prisma.repository';
import { ExpenseClaimPrismaRepository } from '../../src/infrastructure/prisma/expense-claim.prisma.repository';
import { PayoutBankAccountPrismaRepository } from '../../src/infrastructure/prisma/bank-account.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('payout on real Postgres — concurrent writers', () => {
  let drop: () => Promise<void>;
  let claims: ExpenseClaimPrismaRepository;
  let accounts: PayoutBankAccountPrismaRepository;
  let ledger: LedgerPrismaRepository;
  let prismaForWithdrawals: Awaited<ReturnType<typeof freshPrisma>>['prisma'];

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    claims = new ExpenseClaimPrismaRepository(db.prisma as never);
    accounts = new PayoutBankAccountPrismaRepository(db.prisma as never);
    ledger = new LedgerPrismaRepository(db.prisma as never);
    prismaForWithdrawals = db.prisma;
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

      // updatedAt is the CAS token and has millisecond resolution: without a gap the replacement can
      // land in the same millisecond as the account that was shown and the stale token still matches.
      await new Promise((r) => setTimeout(r, 5));
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

  it('two pushes of one order: the unique sourceRef lets exactly one write both rows, the other sees P2002', async () => {
    for (let i = 0; i < 10; i++) {
      const orderId = randomUUID();
      const owner = randomUUID();
      const rows = () => [
        { franchiseOwnerId: owner, depotId: null, type: 'SALE_SETTLEMENT' as const, amount: 100_000, description: 's', sourceRef: `order:${orderId}:SALE`, occurredAt: new Date() },
        { franchiseOwnerId: owner, depotId: null, type: 'COMMISSION' as const, amount: -10_000, description: 'c', sourceRef: `order:${orderId}:COMMISSION`, occurredAt: new Date() },
      ];
      const res = await race([() => ledger.createAll(rows()), () => ledger.createAll(rows())]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((lost.reason as { code?: string }).code).toBe('P2002');
      // All-or-nothing: the loser left no half pair behind.
      expect(await ledger.findByOrder(orderId)).toHaveLength(2);
    }
  });

  it('a double-tapped withdrawal carrying one key debits the balance once; without a key both go through', async () => {
    const withdrawals = new WithdrawalPrismaRepository(prismaForWithdrawals as never);
    for (let i = 0; i < 5; i++) {
      const owner = randomUUID();
      await prismaForWithdrawals.ledgerEntry.create({
        data: { franchiseOwnerId: owner, depotId: null, type: 'SALE_SETTLEMENT', amount: 1_000_000, description: 's' },
      });
      const input = (ref: string, key?: string) => ({
        franchiseOwnerId: owner,
        amount: 100_000,
        bankAccountRef: 'BCA',
        reference: ref,
        status: 'PROCESSING' as const,
        description: 'd',
        ...(key ? { idempotencyKey: key } : {}),
      });
      const key = randomUUID();
      const res = await race(
        Array.from({ length: 5 }, (_, n) => () => withdrawals.withdrawWithDebit(input(`WD-${randomUUID()}-${n}`, key))),
      );
      expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await prismaForWithdrawals.withdrawal.count({ where: { franchiseOwnerId: owner } })).toBe(1);
      expect(await withdrawals.withdrawWithDebit(input(`WD-${randomUUID()}`))).toMatchObject({ ok: true });
      expect(await prismaForWithdrawals.withdrawal.count({ where: { franchiseOwnerId: owner } })).toBe(2);
    }
  });
});
