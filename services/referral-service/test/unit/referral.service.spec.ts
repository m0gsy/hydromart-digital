import { randomUUID } from 'node:crypto';

import { ReferralStatus } from '../../src/domain/referral-status';
import {
  AlreadyReferredError,
  ReferralCodeNotFoundError,
  SelfReferralError,
} from '../../src/domain/errors';
import { ReferralService } from '../../src/application/services/referral.service';
import {
  FakeCustomerDirectory,
  FakeLoyaltyReward,
  InMemoryReferralRepository,
  buildTestConfig,
} from '../support/fakes';

describe('ReferralService', () => {
  let repo: InMemoryReferralRepository;
  let loyalty: FakeLoyaltyReward;
  let service: ReferralService;

  beforeEach(() => {
    repo = new InMemoryReferralRepository();
    loyalty = new FakeLoyaltyReward();
    service = new ReferralService(repo, loyalty, new FakeCustomerDirectory(), buildTestConfig());
  });

  describe('getOrCreateMyCode', () => {
    it('lazily creates a code and returns the same one on repeat reads', async () => {
      const first = await service.getOrCreateMyCode('cust-1');
      expect(first.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(repo.codes).toHaveLength(1);

      const second = await service.getOrCreateMyCode('cust-1');
      expect(second.code).toBe(first.code);
      expect(repo.codes).toHaveLength(1);
    });
  });

  describe('redeem', () => {
    it('creates a PENDING referral on the happy path (code normalised)', async () => {
      const referrer = randomUUID();
      const { code } = await service.getOrCreateMyCode(referrer);
      const referee = randomUUID();

      const referral = await service.redeem(referee, `  ${code.toLowerCase()} `);
      expect(referral).toMatchObject({
        referrerCustomerId: referrer,
        refereeCustomerId: referee,
        code,
        status: ReferralStatus.PENDING,
      });
    });

    it('rejects redeeming your own code (SelfReferralError)', async () => {
      const me = randomUUID();
      const { code } = await service.getOrCreateMyCode(me);
      await expect(service.redeem(me, code)).rejects.toBeInstanceOf(SelfReferralError);
    });

    it('rejects a second redemption by the same referee (AlreadyReferredError)', async () => {
      const { code } = await service.getOrCreateMyCode(randomUUID());
      const otherCode = (await service.getOrCreateMyCode(randomUUID())).code;
      const referee = randomUUID();
      await service.redeem(referee, code);
      await expect(service.redeem(referee, otherCode)).rejects.toBeInstanceOf(AlreadyReferredError);
    });

    it('rejects an unknown code (ReferralCodeNotFoundError)', async () => {
      await expect(service.redeem(randomUUID(), 'NOSUCHCD')).rejects.toBeInstanceOf(
        ReferralCodeNotFoundError,
      );
    });
  });

  describe('qualify', () => {
    async function seedPending(): Promise<{ referrer: string; referee: string }> {
      const referrer = randomUUID();
      const { code } = await service.getOrCreateMyCode(referrer);
      const referee = randomUUID();
      await service.redeem(referee, code);
      return { referrer, referee };
    }

    it('qualifies a PENDING referral, awards both rewards, and sets QUALIFIED', async () => {
      const { referrer, referee } = await seedPending();

      const result = await service.qualify(referee, randomUUID(), 'Bearer tkn');
      expect(result.qualified).toBe(true);
      expect(result.referral).toMatchObject({
        status: ReferralStatus.QUALIFIED,
        referrerPoints: 500,
        refereePoints: 250,
      });

      expect(loyalty.calls).toEqual([
        {
          customerId: referrer,
          points: 500,
          reason: 'Referral reward: referred a new customer',
          authorization: 'Bearer tkn',
        },
        {
          customerId: referee,
          points: 250,
          reason: 'Referral welcome bonus',
          authorization: 'Bearer tkn',
        },
      ]);
    });

    it('is an idempotent no-op when already qualified', async () => {
      const { referee } = await seedPending();
      await service.qualify(referee, randomUUID(), 'Bearer tkn');
      loyalty.calls = [];

      const again = await service.qualify(referee, randomUUID(), 'Bearer tkn');
      expect(again.qualified).toBe(false);
      expect(loyalty.calls).toHaveLength(0);
    });

    it('is a no-op when there is no pending referral', async () => {
      const result = await service.qualify(randomUUID(), randomUUID(), 'Bearer tkn');
      expect(result.qualified).toBe(false);
      expect(loyalty.calls).toHaveLength(0);
    });

    it('still qualifies (fail-open) when a loyalty reward throws', async () => {
      const { referee } = await seedPending();
      loyalty.shouldThrow = true;

      const result = await service.qualify(referee, randomUUID(), 'Bearer tkn');
      expect(result.qualified).toBe(true);
      expect(result.referral?.status).toBe(ReferralStatus.QUALIFIED);
    });
  });

  describe('getMySummary', () => {
    it('reports referred/qualified counts and points earned from qualified referrals', async () => {
      const referrer = randomUUID();
      const { code } = await service.getOrCreateMyCode(referrer);
      const refereeA = randomUUID();
      const refereeB = randomUUID();
      await service.redeem(refereeA, code);
      await service.redeem(refereeB, code);
      await service.qualify(refereeA, randomUUID(), 'Bearer tkn');

      const summary = await service.getMySummary(referrer);
      expect(summary.code.code).toBe(code);
      expect(summary.referredCount).toBe(2);
      expect(summary.qualifiedCount).toBe(1);
      expect(summary.pointsEarned).toBe(500);
      expect(summary.referrals.items).toHaveLength(2);
    });
  });
});
