import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GallonLedgerPrismaRepository } from '../../src/infrastructure/prisma/gallon-ledger.prisma.repository';
import { GallonLedgerController } from '../../src/modules/gallon-ledger.controller';
import { GallonLedgerQueryDto } from '../../src/modules/dto/gallon-ledger.dto';

/*
 * HD-6 H3: the gallon ledger the AI read API reads (G-02, G-03, G-04). The books are read with
 * groupBy over (depotId, createdAt), so no raw SQL: what matters is which window each sum takes.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const from = new Date('2026-10-31T17:00:00.000Z');
const to = new Date('2026-11-30T17:00:00.000Z');
const dec = (n: number) => ({ valueOf: () => String(n), toString: () => String(n) });

describe('GallonLedgerPrismaRepository', () => {
  const books = () => {
    const issue = jest
      .fn()
      .mockResolvedValueOnce([{ depotId: D1, _sum: { quantity: 120, depositHeld: dec(1_800_000) } }])
      .mockResolvedValueOnce([{ depotId: D1, _sum: { quantity: 30, depositHeld: dec(450_000) } }]);
    const ret = jest
      .fn()
      .mockResolvedValueOnce([
        { depotId: D1, _sum: { quantity: 90, depositRefunded: dec(1_350_000) } },
        { depotId: D2, _sum: { quantity: 5, depositRefunded: dec(75_000) } },
      ])
      .mockResolvedValueOnce([
        { depotId: D1, condition: 'GOOD', _sum: { quantity: 20, depositRefunded: dec(300_000) } },
        { depotId: D1, condition: 'DAMAGED', _sum: { quantity: 3, depositRefunded: dec(0) } },
      ]);
    const repo = new GallonLedgerPrismaRepository({ gallonIssue: { groupBy: issue }, gallonReturn: { groupBy: ret } } as never);
    return { issue, ret, repo };
  };

  it('folds the balances and the window into one row per depot, the damaged apart', async () => {
    const { repo } = books();
    const rows = await repo.ledger([D1, D2], from, to);
    expect(rows.find((r) => r.depotId === D1)).toEqual({
      depotId: D1,
      issuedTotal: 120,
      returnedTotal: 90,
      depositHeldTotal: 1_800_000,
      depositRefundedTotal: 1_350_000,
      issuedInWindow: 30,
      depositHeldInWindow: 450_000,
      returnedGoodInWindow: 20,
      returnedDamagedInWindow: 3,
      depositRefundedInWindow: 300_000,
    });
    // a depot with returns only still has a row, with zeros on the issue side
    expect(rows.find((r) => r.depotId === D2)).toMatchObject({ issuedTotal: 0, returnedTotal: 5, issuedInWindow: 0 });
  });

  it('takes the balance from everything before `to` and the window as [from, to)', async () => {
    const { repo, issue, ret } = books();
    await repo.ledger([D1], from, to);
    expect(issue.mock.calls[0][0].where).toEqual({ depotId: { in: [D1] }, createdAt: { lt: to } });
    expect(issue.mock.calls[1][0].where).toEqual({ depotId: { in: [D1] }, createdAt: { gte: from, lt: to } });
    expect(ret.mock.calls[0][0].where).toEqual({ depotId: { in: [D1] }, createdAt: { lt: to } });
    expect(ret.mock.calls[1][0].by).toEqual(['depotId', 'condition']);
  });

  it('treats null sums as zero, never NaN', async () => {
    const empty = jest.fn().mockResolvedValue([{ depotId: D1, condition: 'GOOD', _sum: { quantity: null, depositHeld: null, depositRefunded: null } }]);
    const repo = new GallonLedgerPrismaRepository({ gallonIssue: { groupBy: empty }, gallonReturn: { groupBy: empty } } as never);
    const [row] = await repo.ledger([D1], from, to);
    expect(row).toMatchObject({ issuedTotal: 0, returnedTotal: 0, depositHeldTotal: 0, returnedGoodInWindow: 0 });
  });
});

describe('GallonLedgerController and DTO', () => {
  it('splits the depot list and turns the window into dates', async () => {
    const ledger = jest.fn().mockResolvedValue([]);
    const controller = new GallonLedgerController({ ledger } as never);
    await expect(controller.summary({ depotIds: `${D1},${D2}`, from: from.toISOString(), to: to.toISOString() })).resolves.toEqual({ items: [] });
    expect(ledger).toHaveBeenCalledWith([D1, D2], from, to);
  });

  const errors = async (body: object) => (await validate(plainToInstance(GallonLedgerQueryDto, body))).length;
  const ok = { depotIds: D1, from: from.toISOString(), to: to.toISOString() };

  it('rejects a backwards or over-long window, an unreal date and more than 100 depots', async () => {
    expect(await errors(ok)).toBe(0);
    expect(await errors({ ...ok, from: to.toISOString(), to: from.toISOString() })).toBeGreaterThan(0);
    expect(await errors({ ...ok, from: '2025-01-01T00:00:00.000Z' })).toBeGreaterThan(0);
    expect(await errors({ ...ok, from: '2026-02-30T00:00:00.000Z', to: '2026-03-31T00:00:00.000Z' })).toBeGreaterThan(0);
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
    expect(await errors({ ...ok, depotIds: many })).toBeGreaterThan(0);
    // a balance at one instant is a window of no length
    expect(await errors({ ...ok, from: to.toISOString() })).toBe(0);
  });
});
