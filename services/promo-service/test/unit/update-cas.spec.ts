import { StaleWriteError } from '@hydromart/platform';

import { PromoRulePrismaRepository } from '../../src/infrastructure/prisma/promo-rule.prisma.repository';
import { PromotionPrismaRepository } from '../../src/infrastructure/prisma/promotion.prisma.repository';
import { VoucherPrismaRepository } from '../../src/infrastructure/prisma/voucher.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// Two editors holding the same stamp both passed assertFresh and the second overwrote the
// first. The stamp now rides in the write itself.
describe.each([
  ['promo rule', 'promoRule', (p: PrismaService) => new PromoRulePrismaRepository(p)],
  ['promotion', 'promotion', (p: PrismaService) => new PromotionPrismaRepository(p)],
  ['voucher', 'voucher', (p: PrismaService) => new VoucherPrismaRepository(p)],
] as const)('%s update is a compare-and-set', (_name, key, make) => {
  const model = { update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() };
  const repo = make({ [key]: model } as unknown as PrismaService) as unknown as {
    update(id: string, data: object, at?: Date): Promise<unknown>;
  };
  const stamp = new Date('2026-10-01T00:00:00Z');
  const row = { id: 'x', code: 'A', discountType: 'PERCENT', value: 1, updatedAt: stamp };

  beforeEach(() => jest.clearAllMocks());

  it('writes only while the stamp still matches', async () => {
    model.updateMany.mockResolvedValue({ count: 1 });
    model.findUniqueOrThrow.mockResolvedValue(row);
    await repo.update('x', { active: false }, stamp);
    expect(model.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'x', updatedAt: stamp } }),
    );
    expect(model.update).not.toHaveBeenCalled();
  });

  it('refuses when somebody wrote first', async () => {
    model.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.update('x', { active: false }, stamp)).rejects.toBeInstanceOf(StaleWriteError);
  });

  it('without a stamp it is the plain update', async () => {
    model.update.mockResolvedValue(row);
    await repo.update('x', { active: false });
    expect(model.update).toHaveBeenCalled();
    expect(model.updateMany).not.toHaveBeenCalled();
  });
});
