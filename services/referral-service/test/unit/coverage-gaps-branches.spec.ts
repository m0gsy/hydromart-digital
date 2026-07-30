import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { SettingsCache } from '@hydromart/platform';

import { ReferralService } from '../../src/application/services/referral.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsController } from '../../src/modules/settings.controller';
import {
  FakeCustomerDirectory,
  FakeLoyaltyReward,
  InMemoryReferralRepository,
  InMemorySettingsRepository,
  buildTestConfig,
} from '../support/fakes';

// Gap-fill: the retry/race/lost-race branches of ReferralService and the guard branches of
// SettingsService that the happy-path service specs never reach.

describe('ReferralService branch gaps', () => {
  let repo: InMemoryReferralRepository;
  let loyalty: FakeLoyaltyReward;
  let service: ReferralService;

  beforeEach(() => {
    repo = new InMemoryReferralRepository();
    loyalty = new FakeLoyaltyReward();
    service = new ReferralService(repo, loyalty, new FakeCustomerDirectory(), buildTestConfig());
  });

  describe('getOrCreateMyCode', () => {
    it('retries on a code collision, then persists a free code', async () => {
      jest
        .spyOn(repo, 'findCodeByCode')
        .mockResolvedValueOnce({ id: 'x', customerId: 'other', code: 'TAKEN123', createdAt: new Date() })
        .mockResolvedValue(null);
      const out = await service.getOrCreateMyCode('cust-1');
      expect(out.customerId).toBe('cust-1');
      expect(repo.codes).toHaveLength(1);
    });

    it('re-reads and returns the raced code when createCode loses a unique race', async () => {
      const raced = { id: 'r', customerId: 'cust-1', code: 'RACED123', createdAt: new Date() };
      jest.spyOn(repo, 'findCodeByCode').mockResolvedValue(null);
      jest
        .spyOn(repo, 'findCodeByCustomer')
        .mockResolvedValueOnce(null) // top-of-method read: no code yet
        .mockResolvedValue(raced); // re-read after the collision
      jest.spyOn(repo, 'createCode').mockRejectedValue(new Error('unique constraint'));

      expect(await service.getOrCreateMyCode('cust-1')).toEqual(raced);
    });

    it('throws after exhausting retries when every generated code collides', async () => {
      jest
        .spyOn(repo, 'findCodeByCode')
        .mockResolvedValue({ id: 'x', customerId: 'other', code: 'ALLTAKEN', createdAt: new Date() });
      await expect(service.getOrCreateMyCode('cust-1')).rejects.toThrow(
        'Could not generate a unique referral code.',
      );
    });
  });

  describe('qualify', () => {
    it('is a no-op when the atomic transition loses the race (updated null)', async () => {
      const referrer = randomUUID();
      const { code } = await service.getOrCreateMyCode(referrer);
      const referee = randomUUID();
      await service.redeem(referee, code);
      jest.spyOn(repo, 'qualifyReferral').mockResolvedValue(null);

      const result = await service.qualify(referee, randomUUID(), 'Bearer tkn');
      expect(result.qualified).toBe(false);
      expect(loyalty.calls).toHaveLength(0);
    });
  });

  describe('depotSummary', () => {
    it('returns 0% conversion when the depot has customers but no referrals', async () => {
      const dir = new FakeCustomerDirectory({ d1: ['cust-1', 'cust-2'] });
      const svc = new ReferralService(repo, loyalty, dir, buildTestConfig());
      const out = await svc.depotSummary('d1');
      expect(out).toMatchObject({ invited: 0, qualified: 0, conversionPct: 0, pointsAwarded: 0 });
    });

    it('computes conversion when the depot has qualified referrals', async () => {
      const referrer = randomUUID();
      const { code } = await service.getOrCreateMyCode(referrer);
      const referee = randomUUID();
      await service.redeem(referee, code);
      await service.qualify(referee, randomUUID(), '');

      const dir = new FakeCustomerDirectory({ d1: [referrer] });
      const svc = new ReferralService(repo, loyalty, dir, buildTestConfig());
      const out = await svc.depotSummary('d1');
      expect(out.invited).toBe(1);
      expect(out.qualified).toBe(1);
      expect(out.conversionPct).toBe(100);
    });
  });

  describe('summary pagination clamps', () => {
    it('clamps a below-range page and an above-range limit', async () => {
      const referrer = randomUUID();
      await service.getOrCreateMyCode(referrer);
      const summary = await service.getCustomerSummary(referrer, 0, 999);
      expect(summary.referrals.page).toBe(1); // page clamped up to 1
      expect(summary.referrals.limit).toBe(100); // limit clamped down to MAX_LIMIT
    });
  });
});

describe('SettingsService branch gaps', () => {
  function svc(): SettingsService {
    const repo = new InMemorySettingsRepository();
    return new SettingsService(repo, new SettingsCache(repo));
  }

  it('put rejects a DEPOT scope without a depotId (before the global-only check)', async () => {
    await expect(
      svc().put({ scope: 'DEPOT', depotId: null, key: 'referrerPoints', value: '100', updatedBy: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('put rejects a value below the registry minimum', async () => {
    await expect(
      svc().put({ scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '-1', updatedBy: 'u1' }),
    ).rejects.toThrow('below min');
  });

  it('reset removes a DEPOT override, keeping the depotId in the key', async () => {
    const s = svc();
    // reset does not enforce global-only, so a DEPOT-scoped reset exercises the non-null side.
    await expect(s.reset('DEPOT', 'd1', 'referrerPoints')).resolves.toBeUndefined();
    expect(s.cache.effective('referrerPoints', 'int', 500)).toBe(500);
  });

  it('put persists a valid GLOBAL override and refreshes the cache', async () => {
    const s = svc();
    await s.put({ scope: 'GLOBAL', depotId: null, key: 'refereePoints', value: '300', updatedBy: 'u1' });
    expect(s.cache.effective('refereePoints', 'int', 250)).toBe(300);
  });

});

describe('SettingsController reset depotId branch', () => {
  it('passes an explicit depotId through and defaults a missing one to null', async () => {
    const reset = jest.fn().mockResolvedValue(undefined);
    const controller = new SettingsController({ reset } as unknown as SettingsService);
    const staff = { sub: 'u1', role: 'MANAGER' } as unknown as import('@hydromart/platform').AuthenticatedUser;

    await controller.reset({ scope: 'DEPOT', depotId: 'd1', key: 'referrerPoints' }, staff);
    expect(reset).toHaveBeenLastCalledWith('DEPOT', 'd1', 'referrerPoints');

    await controller.reset({ scope: 'DEPOT', key: 'referrerPoints' } as never, staff);
    expect(reset).toHaveBeenLastCalledWith('DEPOT', null, 'referrerPoints');
  });

  it('forbids a non-SUPER_ADMIN from resetting a GLOBAL default', async () => {
    const reset = jest.fn();
    const controller = new SettingsController({ reset } as unknown as SettingsService);
    const staff = { sub: 'u1', role: 'MANAGER' } as unknown as import('@hydromart/platform').AuthenticatedUser;
    await expect(
      controller.reset({ scope: 'GLOBAL', key: 'referrerPoints' } as never, staff),
    ).rejects.toThrow('Only SUPER_ADMIN');
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('ReferralService summary paging clamps', () => {
  function svc(): ReferralService {
    const repo = new InMemoryReferralRepository();
    return new ReferralService(repo, new FakeLoyaltyReward(), new FakeCustomerDirectory(), buildTestConfig());
  }

  it('uses default page/limit when called with only a customerId', async () => {
    const summary = await svc().getMySummary('cust-1');
    expect(summary.referrals.page).toBe(1);
    expect(summary.referrals.limit).toBe(20);
  });

  it('clamps page below 1 up to 1 and an over-max limit down to MAX_LIMIT', async () => {
    const summary = await svc().getCustomerSummary('cust-1', 0, 9999);
    expect(summary.referrals.page).toBe(1);
    expect(summary.referrals.limit).toBe(100);
  });

  it('clamps a zero limit up to 1', async () => {
    const summary = await svc().getMySummary('cust-1', 5, 0);
    expect(summary.referrals.limit).toBe(1);
  });
});
