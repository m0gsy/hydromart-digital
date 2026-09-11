import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { Prisma } from '../../prisma/generated/client';
import { VoucherPrismaRepository } from '../../src/infrastructure/prisma/voucher.prisma.repository';

/**
 * SEC-AUDIT PRM-3 — the voucher that could never be redeemed.
 *
 * `vouchers.id` and `voucher_redemptions.voucherId` are TEXT (migration 0001), and four raw
 * queries compared them with `${id}::uuid`. Postgres has no `text = uuid` operator, so every
 * redemption, every release and the promotion analytics failed with
 * `operator does not exist: text = uuid` — checkout failed closed, so no money moved, and no
 * voucher was honoured, from 2026-08-03 on.
 *
 * Every other spec here drives an in-memory fake, so this SQL had never run anywhere. This
 * one captures the exact SQL the repository sends and runs it on a real Postgres (PGlite)
 * built from the service's own migrations, so a type mismatch between a raw query and the
 * schema fails here instead of at the till. PGlite runs in a child process — see
 * `test/support/run-sql.mjs` for why.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const RUNNER = join(__dirname, '..', 'support', 'run-sql.mjs');
const VOUCHER_ID = '3f1c2b4a-8d6e-4f7a-9b0c-1d2e3f4a5b6c';
const ORDER_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

type Captured = { text: string; values: unknown[] };
type Result = { ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string };

/** A client that records every raw statement and answers the way an empty-but-valid DB would. */
function recordingPrisma(captured: Captured[]) {
  const queryRaw = (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
    const sql = 'raw' in query ? Prisma.sql(query, ...values) : query;
    captured.push({ text: sql.text, values: sql.values });
    // The lock has to find the row for the repository to carry on to its writes.
    return Promise.resolve(/FOR UPDATE/.test(sql.text) ? [{ usedCount: 0 }] : []);
  };
  const models = {
    voucherRedemption: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { discountApplied: 0 } }),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'r-1', createdAt: new Date(), ...data })),
      findUnique: jest.fn().mockResolvedValue({ id: 'r-1', voucherId: VOUCHER_ID, orderId: ORDER_ID }),
      delete: jest.fn().mockResolvedValue({}),
    },
    voucher: { update: jest.fn().mockResolvedValue({}) },
  };
  const tx = { ...models, $queryRaw: queryRaw };
  return { ...tx, $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
}

function runOnPostgres(queries: Captured[]): Result[] {
  const seed: Captured[] = [
    {
      text: `INSERT INTO "vouchers" ("id", "code", "discountType", "value", "usedCount", "updatedAt")
             VALUES ($1, 'HEMAT10', 'PERCENTAGE', 10, 0, NOW())`,
      values: [VOUCHER_ID],
    },
    {
      text: `INSERT INTO "voucher_redemptions"
               ("id", "voucherId", "voucherCode", "customerId", "orderId", "discountApplied", "createdAt")
             VALUES ('r-0', $1, 'HEMAT10', 'c-1', $2, 5000, '2026-08-20T03:00:00Z')`,
      values: [VOUCHER_ID, ORDER_ID],
    },
  ];
  const out = execFileSync(process.execPath, [RUNNER], {
    input: JSON.stringify({ migrations: MIGRATIONS, seed, queries }),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return JSON.parse(out) as Result[];
}

describe('voucher raw SQL on the real schema (PRM-3)', () => {
  const captured: Captured[] = [];
  let results: Result[];

  beforeAll(async () => {
    const repo = new VoucherPrismaRepository(recordingPrisma(captured) as never);
    await repo.redeemAtomic(
      { voucherId: VOUCHER_ID, voucherCode: 'HEMAT10', customerId: 'c-2', orderId: 'o-2' },
      () => 1000,
    );
    await repo.releaseAtomic(ORDER_ID);
    await repo.redemptionAnalytics(
      VOUCHER_ID,
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
      5,
      'Asia/Jakarta',
    );
    results = runOnPostgres(captured);
  });

  it('sends the four raw statements this spec exists for', () => {
    // Redeem lock, release lock, daily uses, distinct orders. If the repository grows or
    // drops a raw statement, this count is where the spec finds out it must look again.
    expect(captured).toHaveLength(4);
  });

  it('runs every one of them on the schema the migrations actually build', () => {
    expect(results.map((r) => (r.ok ? 'ok' : r.error))).toEqual(captured.map(() => 'ok'));
  });

  it('finds the voucher it locks, and the redemption it counts', () => {
    const [redeemLock, releaseLock, daily, orders] = results as Extract<Result, { ok: true }>[];
    expect(redeemLock.rows).toEqual([{ usedCount: 0 }]);
    expect(releaseLock.rows).toEqual([{ usedCount: 0 }]);
    // 03:00 UTC on 20 August is 10:00 WIB the same day — the two-hop zone read (C2) intact.
    expect(daily.rows).toEqual([{ day: '2026-08-20', uses: 1 }]);
    expect(orders.rows).toEqual([{ orderId: ORDER_ID }]);
  });
});
