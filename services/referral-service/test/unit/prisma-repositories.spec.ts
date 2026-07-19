import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ReferralPrismaRepository } from '../../src/infrastructure/prisma/referral.prisma.repository';
import { ReferralStatus } from '../../src/domain/referral-status';

// Unit-tests the referral-service Prisma repository against per-model jest.fn() mocks of
// PrismaService. No real database: each test asserts the EXACT prisma call args and the
// row->record status mapping. $transaction supports both forms the repo uses: the array
// form (returns the pre-built ops as-is) and the interactive-callback form (invoked with a
// `tx` bound to the same referral model mock). Mirrors
// services/auth-service/test/unit/prisma-repositories.spec.ts.

describe('ReferralPrismaRepository', () => {
  const referral = {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    updateMany: jest.fn(),
  };
  const referralCode = { findUnique: jest.fn(), create: jest.fn() };
  const $transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)({ referral })
      : Promise.resolve(arg),
  );
  const prisma = { referral, referralCode, $transaction } as unknown as PrismaService;
  const repo = new ReferralPrismaRepository(prisma);

  const codeRow = { id: 'code-1', customerId: 'cust-1', code: 'BUDI10', createdAt: new Date('2026-01-01') };
  const referralRow = () => ({
    id: 'ref-1',
    referrerCustomerId: 'cust-1',
    refereeCustomerId: 'cust-2',
    code: 'BUDI10',
    status: 'PENDING',
    qualifyingOrderId: null,
    referrerPoints: 0,
    refereePoints: 0,
    qualifiedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('finds a code by customer and by code', async () => {
    referralCode.findUnique.mockResolvedValue(codeRow);
    expect(await repo.findCodeByCustomer('cust-1')).toEqual(codeRow);
    expect(referralCode.findUnique).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
    await repo.findCodeByCode('BUDI10');
    expect(referralCode.findUnique).toHaveBeenLastCalledWith({ where: { code: 'BUDI10' } });
  });

  it('creates a code', async () => {
    referralCode.create.mockResolvedValue(codeRow);
    expect(await repo.createCode('cust-1', 'BUDI10')).toEqual(codeRow);
    expect(referralCode.create).toHaveBeenCalledWith({ data: { customerId: 'cust-1', code: 'BUDI10' } });
  });

  it('finds a referral by referee and maps the status enum, null on miss', async () => {
    referral.findUnique.mockResolvedValue(referralRow());
    const out = await repo.findReferralByReferee('cust-2');
    expect(out?.status).toBe(ReferralStatus.PENDING);
    expect(referral.findUnique).toHaveBeenCalledWith({ where: { refereeCustomerId: 'cust-2' } });

    referral.findUnique.mockResolvedValue(null);
    expect(await repo.findReferralByReferee('nope')).toBeNull();
  });

  it('creates a referral and maps the status', async () => {
    referral.create.mockResolvedValue(referralRow());
    const out = await repo.createReferral({
      referrerCustomerId: 'cust-1',
      refereeCustomerId: 'cust-2',
      code: 'BUDI10',
    });
    expect(out.status).toBe(ReferralStatus.PENDING);
    expect(referral.create).toHaveBeenCalledWith({
      data: { referrerCustomerId: 'cust-1', refereeCustomerId: 'cust-2', code: 'BUDI10' },
    });
  });

  it('lists a referrer referrals with pagination and total', async () => {
    referral.findMany.mockReturnValue([referralRow()] as never);
    referral.count.mockReturnValue(1 as never);
    const out = await repo.listReferralsByReferrer('cust-1', 2, 10);
    expect(out.total).toBe(1);
    expect(out.items[0].status).toBe(ReferralStatus.PENDING);
    expect(referral.findMany).toHaveBeenCalledWith({
      where: { referrerCustomerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(referral.count).toHaveBeenCalledWith({ where: { referrerCustomerId: 'cust-1' } });
  });

  it('summarizes a referrer (total, qualified, points earned)', async () => {
    referral.count
      .mockReturnValueOnce(5 as never) // referredCount
      .mockReturnValueOnce(2 as never); // qualifiedCount
    referral.aggregate.mockReturnValue({ _sum: { referrerPoints: 300 } } as never);
    const out = await repo.summarizeReferrer('cust-1');
    expect(out).toEqual({ referredCount: 5, qualifiedCount: 2, pointsEarned: 300 });
  });

  it('defaults points earned to 0 when the sum is null', async () => {
    referral.count.mockReturnValueOnce(0 as never).mockReturnValueOnce(0 as never);
    referral.aggregate.mockReturnValue({ _sum: { referrerPoints: null } } as never);
    const out = await repo.summarizeReferrer('cust-1');
    expect(out.pointsEarned).toBe(0);
  });

  it('short-circuits the depot-scoped aggregates on an empty referrer list', async () => {
    expect(await repo.countReferrals([])).toBe(0);
    expect(await repo.countQualified([])).toBe(0);
    expect(await repo.sumReferrerPoints([])).toBe(0);
    expect(await repo.topReferrers([])).toEqual([]);
    expect(referral.count).not.toHaveBeenCalled();
    expect(referral.aggregate).not.toHaveBeenCalled();
    expect(referral.groupBy).not.toHaveBeenCalled();
  });

  it('counts referrals and qualified referrals over a referrer list', async () => {
    referral.count.mockResolvedValue(4);
    expect(await repo.countReferrals(['cust-1', 'cust-2'])).toBe(4);
    expect(referral.count).toHaveBeenCalledWith({ where: { referrerCustomerId: { in: ['cust-1', 'cust-2'] } } });

    referral.count.mockResolvedValue(3);
    expect(await repo.countQualified(['cust-1'])).toBe(3);
    expect(referral.count).toHaveBeenLastCalledWith({
      where: { referrerCustomerId: { in: ['cust-1'] }, status: ReferralStatus.QUALIFIED },
    });
  });

  it('sums referrer points over qualified referrals (null -> 0)', async () => {
    referral.aggregate.mockResolvedValue({ _sum: { referrerPoints: 250 } });
    expect(await repo.sumReferrerPoints(['cust-1'])).toBe(250);

    referral.aggregate.mockResolvedValue({ _sum: { referrerPoints: null } });
    expect(await repo.sumReferrerPoints(['cust-1'])).toBe(0);
  });

  it('ranks top referrers by qualified-referral count', async () => {
    referral.groupBy.mockResolvedValue([
      { referrerCustomerId: 'cust-1', _count: { referrerCustomerId: 3 }, _sum: { referrerPoints: 300 } },
      { referrerCustomerId: 'cust-2', _count: { referrerCustomerId: 1 }, _sum: { referrerPoints: null } },
    ]);
    const out = await repo.topReferrers(['cust-1', 'cust-2'], 5);
    expect(out).toEqual([
      { customerId: 'cust-1', referralCount: 3, pointsEarned: 300 },
      { customerId: 'cust-2', referralCount: 1, pointsEarned: 0 },
    ]);
    expect(referral.groupBy).toHaveBeenCalledWith({
      by: ['referrerCustomerId'],
      where: { referrerCustomerId: { in: ['cust-1', 'cust-2'] }, status: ReferralStatus.QUALIFIED },
      _count: { referrerCustomerId: true },
      _sum: { referrerPoints: true },
      orderBy: { _count: { referrerCustomerId: 'desc' } },
      take: 5,
    });
  });

  it('qualifies a PENDING referral, returning the updated record', async () => {
    referral.updateMany.mockResolvedValue({ count: 1 });
    referral.findUnique.mockResolvedValue({ ...referralRow(), status: 'QUALIFIED', qualifyingOrderId: 'ord-9' });
    const out = await repo.qualifyReferral('ref-1', 'ord-9', 100, 50);
    expect(out?.status).toBe(ReferralStatus.QUALIFIED);
    expect(referral.updateMany).toHaveBeenCalledWith({
      where: { id: 'ref-1', status: ReferralStatus.PENDING },
      data: expect.objectContaining({
        status: ReferralStatus.QUALIFIED,
        qualifyingOrderId: 'ord-9',
        referrerPoints: 100,
        refereePoints: 50,
      }),
    });
  });

  it('returns null when the referral was not PENDING (lost race)', async () => {
    referral.updateMany.mockResolvedValue({ count: 0 });
    const out = await repo.qualifyReferral('ref-1', 'ord-9', 100, 50);
    expect(out).toBeNull();
    expect(referral.findUnique).not.toHaveBeenCalled();
  });
});
