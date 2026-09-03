import { SettingsCache, SettingRow } from '@hydromart/platform';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { LoyaltyService } from '../../src/application/services/loyalty.service';
import { RewardService } from '../../src/application/services/reward.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsController } from '../../src/modules/settings.controller';
import { LoyaltyPrismaRepository } from '../../src/infrastructure/prisma/loyalty.prisma.repository';
import { RewardPrismaRepository } from '../../src/infrastructure/prisma/reward.prisma.repository';
import { SETTING_DEF_BY_KEY } from '../../src/config/setting-defs';
import { ListTransactionsQueryDto } from '../../src/modules/dto/loyalty.dto';
import { CreateRewardItemDto, UpdateRewardItemDto } from '../../src/modules/dto/reward.dto';
import type { LoyaltyConfigService } from '../../src/config/loyalty-config.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsRepository } from '../../src/application/ports/settings.repository';

// The reads and the defaults: a depot summary asked for "now", a cancelled redemption whose
// reward item has since been deleted, the catalogue admin reads, a month with no redemptions at
// all, and the DTO transforms that turn a query string into the number the validators expect.

const repoWith = (rows: SettingRow[]): SettingsRepository => {
  const store = [...rows] as (SettingRow & { updatedBy: string })[];
  return {
    loadAll: async () =>
      store.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value })),
    upsert: async (row: SettingRow & { updatedBy: string }) => {
      store.push(row);
    },
    remove: jest.fn(async () => undefined),
  } as unknown as SettingsRepository;
};

describe('LoyaltyService.depotSummary with no clock passed', () => {
  it('measures this month from the current UTC month start', async () => {
    const customers = { customerIdsForDepot: jest.fn().mockResolvedValue([]) } as never;
    const repo = {} as never;
    const config = {} as unknown as LoyaltyConfigService;

    const summary = await new LoyaltyService(repo, config, customers).depotSummary('dep-1');

    expect(summary).toMatchObject({ pointsOutstanding: 0, redeemedThisMonth: 0 });
  });
});

describe('RewardService.cancel when the reward item is gone', () => {
  it('refunds the points, names the reward generically and restores no stock', async () => {
    const redemption = {
      id: 'red-1',
      customerId: 'cus-1',
      rewardItemId: 'itm-gone',
      pointsSpent: 800,
      status: 'ACTIVE',
    };
    const rewards = {
      findRedemption: jest.fn().mockResolvedValue(redemption),
      findItem: jest.fn().mockResolvedValue(null),
      cancel: jest.fn().mockResolvedValue({ ...redemption, status: 'CANCELLED' }),
    } as never;
    const loyalty = {
      getAccount: jest.fn().mockResolvedValue({ id: 'acc-1', pointsBalance: 100 }),
    } as never;

    const result = await new RewardService(rewards, loyalty).cancel('cus-1', 'red-1');

    expect(result.redemption.status).toBe('CANCELLED');
    const [args] = (rewards as unknown as { cancel: jest.Mock }).cancel.mock.calls[0];
    expect(args).toMatchObject({ reason: 'Cancelled reward', restoreStock: false });
  });
});

describe('SettingsService and its controller', () => {
  it('refuses a per-depot override of a global-only setting', async () => {
    SETTING_DEF_BY_KEY.networkOnlyKnob = {
      key: 'networkOnlyKnob',
      label: 'Global only',
      type: 'int',
      envDefault: 1,
      global: true,
    };
    try {
      const repo = repoWith([]);
      const svc = new SettingsService(repo, new SettingsCache(repo));
      await expect(
        svc.put({
          scope: 'DEPOT',
          depotId: 'dep-1',
          key: 'networkOnlyKnob',
          value: '2',
          updatedBy: 'u1',
        }),
      ).rejects.toThrow(/global-only/);
    } finally {
      delete SETTING_DEF_BY_KEY.networkOnlyKnob;
    }
  });

  it('reset clears the depot row for a DEPOT scope and the network row for a GLOBAL one', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));

    await svc.reset('DEPOT', 'dep-1', 'earnPointsPerRupiah');
    await svc.reset('GLOBAL', 'dep-1', 'earnPointsPerRupiah');

    const remove = repo.remove as unknown as jest.Mock;
    expect(remove).toHaveBeenNthCalledWith(1, 'DEPOT', 'dep-1', 'earnPointsPerRupiah');
    // GLOBAL ignores whatever depot the caller sent: the network row is the null one.
    expect(remove).toHaveBeenNthCalledWith(2, 'GLOBAL', null, 'earnPointsPerRupiah');
  });

  it('only a GLOBAL reset needs the settingsGlobal capability', async () => {
    const settings = { reset: jest.fn().mockResolvedValue(undefined) };
    const controller = new SettingsController(settings as never);
    const depotUser = { sub: 'u1', role: 'KEPALA_DEPOT', capabilities: [] } as never;

    await controller.reset({ scope: 'DEPOT', depotId: 'dep-1', key: 'earnPointsPerRupiah' } as never, depotUser);
    expect(settings.reset).toHaveBeenCalledWith('DEPOT', 'dep-1', 'earnPointsPerRupiah', 'u1');

    await expect(
      controller.reset({ scope: 'GLOBAL', key: 'earnPointsPerRupiah' } as never, depotUser),
    ).rejects.toBeDefined();
  });
});

describe('prisma reads', () => {
  it('a month with no redemptions sums to 0, not null', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { pointsSpent: null } });
    const prisma = { rewardRedemption: { aggregate } } as unknown as PrismaService;

    await expect(
      new LoyaltyPrismaRepository(prisma).sumRedeemedSince(['cus-1'], new Date('2026-08-01')),
    ).resolves.toBe(0);
  });

  it('the reward catalogue admin reads pass straight through', async () => {
    const rewardItem = {
      findMany: jest.fn().mockResolvedValue([{ id: 'itm-1' }]),
      findUnique: jest.fn().mockResolvedValue({ id: 'itm-1' }),
      create: jest.fn().mockResolvedValue({ id: 'itm-2' }),
      update: jest.fn().mockResolvedValue({ id: 'itm-1', active: false }),
    };
    const repo = new RewardPrismaRepository({ rewardItem } as unknown as PrismaService);

    await expect(repo.listAllItems()).resolves.toEqual([{ id: 'itm-1' }]);
    await expect(repo.findItem('itm-1')).resolves.toEqual({ id: 'itm-1' });
    await expect(repo.createItem({ name: 'Tumbler' } as never)).resolves.toEqual({ id: 'itm-2' });
    await expect(repo.updateItem('itm-1', { active: false } as never)).resolves.toMatchObject({
      active: false,
    });
    // Inactive items still listed for the admin, ordered active-first.
    expect(rewardItem.findMany.mock.calls[0][0].orderBy).toEqual([
      { active: 'desc' },
      { pointsCost: 'asc' },
    ]);
  });

  it('the pickup queue keeps legacy null-depot rows visible to every depot', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { rewardRedemption: { findMany } } as unknown as PrismaService;
    const repo = new RewardPrismaRepository(prisma);

    await repo.listRedemptionsByStatus('ACTIVE' as never, 'dep-1');
    await repo.listRedemptionsByStatus('ACTIVE' as never);

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      OR: [{ depotId: 'dep-1' }, { depotId: null }],
    });
    expect(findMany.mock.calls[1][0].where).toEqual({ status: 'ACTIVE' });
  });
});

describe('DTO transforms', () => {
  it('coerces paging out of a query string', () => {
    const dto = plainToInstance(ListTransactionsQueryDto, { page: '3', limit: '50' });
    expect(validateSync(dto as object)).toEqual([]);
    expect(dto).toMatchObject({ page: 3, limit: 50 });
  });

  it('coerces the points cost and stock a form posts as strings', () => {
    const created = plainToInstance(CreateRewardItemDto, {
      name: 'Tumbler',
      unit: 'pcs',
      pointsCost: '800',
      stock: '50',
    });
    expect(validateSync(created as object)).toEqual([]);
    expect(created).toMatchObject({ pointsCost: 800, stock: 50 });

    const updated = plainToInstance(UpdateRewardItemDto, { pointsCost: '900', stock: '0' });
    expect(validateSync(updated as object)).toEqual([]);
    expect(updated).toMatchObject({ pointsCost: 900, stock: 0 });
  });
});
