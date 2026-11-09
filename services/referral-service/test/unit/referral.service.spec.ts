import { randomUUID } from 'node:crypto';

import { ReferralStatus } from '../../src/domain/referral-status';
import {
  AlreadyReferredError,
  NotANewCustomerError,
  OrderHistoryUnavailableError,
  ReferralCodeNotFoundError,
  SelfReferralError,
} from '../../src/domain/errors';
import { ReferralService } from '../../src/application/services/referral.service';
import {
  FakeCustomerDirectory,
  FakeOrderHistory,
  FakeLoyaltyReward,
  InMemoryReferralRepository,
  buildTestConfig,
} from '../support/fakes';

describe('ReferralService', () => {
  let repo: InMemoryReferralRepository;
  let loyalty: FakeLoyaltyReward;
  let history: FakeOrderHistory;
  let service: ReferralService;

  beforeEach(() => {
    repo = new InMemoryReferralRepository();
    loyalty = new FakeLoyaltyReward();
    history = new FakeOrderHistory();
    service = new ReferralService(
      repo,
      loyalty,
      new FakeCustomerDirectory(),
      buildTestConfig(),
      history,
    );
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

    // CA-3-40. "New customer" was in the docblock and nowhere in the code, so a customer
    // who had shopped here for years could redeem one.
    it('refuses a customer who has already completed an order (CA-3-40)', async () => {
      const { code } = await service.getOrCreateMyCode(randomUUID());
      const returning = new ReferralService(
        repo,
        loyalty,
        new FakeCustomerDirectory(),
        buildTestConfig(),
        new FakeOrderHistory(true),
      );
      await expect(returning.redeem(randomUUID(), code)).rejects.toBeInstanceOf(
        NotANewCustomerError,
      );
      expect(repo.referrals).toHaveLength(0);
    });

    // Fails CLOSED: an unanswerable question refuses rather than paying out 750 points.
    it('refuses when order history cannot be read (CA-3-40)', async () => {
      const { code } = await service.getOrCreateMyCode(randomUUID());
      const blind = new ReferralService(
        repo,
        loyalty,
        new FakeCustomerDirectory(),
        buildTestConfig(),
        new FakeOrderHistory(null),
      );
      await expect(blind.redeem(randomUUID(), code)).rejects.toBeInstanceOf(
        OrderHistoryUnavailableError,
      );
      expect(repo.referrals).toHaveLength(0);
    });

    // Ordering: the three local checks come first, so a wrong code never costs a network
    // call — proved by a service whose history port would refuse if it were reached.
    it('refuses a wrong code without asking order-service (CA-3-40)', async () => {
      const blind = new ReferralService(
        repo,
        loyalty,
        new FakeCustomerDirectory(),
        buildTestConfig(),
        new FakeOrderHistory(null),
      );
      await expect(blind.redeem(randomUUID(), 'NOPENOPE')).rejects.toBeInstanceOf(
        ReferralCodeNotFoundError,
      );
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

  /*
   * REF-03. The qualify trigger rides order-service's outbox; when it is lost (or exhausts its
   * retries) the referral stays PENDING for ever although the referee did complete an order.
   * This sweep asks order-service instead, and qualifies through the same path as the trigger -
   * so the same idempotent reward keys, the same monthly cap, the same void guards apply.
   */
  describe('reconcilePending (REF-03)', () => {
    async function pending(n = 1) {
      const referrer = randomUUID();
      const { code } = await service.getOrCreateMyCode(referrer);
      const referees: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const referee = randomUUID();
        await service.redeem(referee, code);
        referees.push(referee);
      }
      return { referrer, referees };
    }
    const hourLater = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

    it('qualifies a PENDING referral whose referee has a completed order', async () => {
      const { referees } = await pending();
      history.completed.set(referees[0], 'order-1');
      const out = await service.reconcilePending(hourLater());
      expect(out).toEqual({ checked: 1, qualified: 1, held: 0, failed: 0 });
      expect((await repo.findReferralByReferee(referees[0]))?.status).toBe(ReferralStatus.QUALIFIED);
    });

    it('leaves a referral alone when the referee has no completed order, or order-service cannot say', async () => {
      const { referees } = await pending(2);
      history.completed.set(referees[1], null);
      const out = await service.reconcilePending(hourLater());
      expect(out).toEqual({ checked: 2, qualified: 0, held: 0, failed: 0 });
    });

    it('does not touch a referral younger than an hour (the outbox is probably still on it)', async () => {
      const { referees } = await pending();
      history.completed.set(referees[0], 'order-1');
      expect(await service.reconcilePending(new Date())).toEqual({ checked: 0, qualified: 0, held: 0, failed: 0 });
    });

    it('counts a held (over the monthly cap) and a failed qualification, and carries on', async () => {
      const { referees } = await pending(2);
      history.completed.set(referees[0], 'order-1');
      history.completed.set(referees[1], 'order-2');
      const spy = jest.spyOn(service, 'qualify');
      spy.mockResolvedValueOnce({ qualified: false, held: true });
      spy.mockRejectedValueOnce(new Error('loyalty down'));
      const out = await service.reconcilePending(hourLater());
      expect(out).toEqual({ checked: 2, qualified: 0, held: 1, failed: 1 });
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

      const orderId = randomUUID();
      const result = await service.qualify(referee, orderId, 'Bearer tkn');
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
          idempotencyKey: `referral:${result.referral?.id}:${orderId}:referrer`,
        },
        {
          customerId: referee,
          points: 250,
          reason: 'Referral welcome bonus',
          authorization: 'Bearer tkn',
          idempotencyKey: `referral:${result.referral?.id}:${orderId}:referee`,
        },
      ]);
    });

    /*
     * REF-04 (owner decision 2026-11-09). A referrer could farm points with any number of
     * accounts: nothing capped how many referrals one code could pay out. Twenty a calendar
     * month; the 21st is HELD (stays PENDING, nobody is paid, a warning is logged) and is
     * picked up again once the month turns over - it is never silently dropped or paid.
     */
    it('holds the referral that would exceed the monthly cap, and pays nobody (REF-04)', async () => {
      const referrer = randomUUID();
      const { code } = await service.getOrCreateMyCode(referrer);
      for (let i = 0; i < ReferralService.MAX_QUALIFIED_PER_MONTH; i += 1) {
        const referee = randomUUID();
        await service.redeem(referee, code);
        expect((await service.qualify(referee, randomUUID(), '')).qualified).toBe(true);
      }
      const extra = randomUUID();
      await service.redeem(extra, code);
      loyalty.calls = [];

      const result = await service.qualify(extra, randomUUID(), '');

      expect(result).toEqual({ qualified: false, held: true });
      expect(loyalty.calls).toHaveLength(0);
      expect((await repo.findReferralByReferee(extra))?.status).toBe(ReferralStatus.PENDING);
    });

    it('does not hold another referrer for the first referrer\'s volume (REF-04)', async () => {
      const busy = randomUUID();
      const { code } = await service.getOrCreateMyCode(busy);
      for (let i = 0; i < ReferralService.MAX_QUALIFIED_PER_MONTH; i += 1) {
        const referee = randomUUID();
        await service.redeem(referee, code);
        await service.qualify(referee, randomUUID(), '');
      }
      const { referee } = await seedPending();
      expect((await service.qualify(referee, randomUUID(), '')).qualified).toBe(true);
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

    it('does nothing when a void has no referral', async () => {
      await service.reverseForVoidedOrder(randomUUID(), randomUUID());
      expect(loyalty.reversals).toHaveLength(0);
      expect(repo.voidedOrders.size).toBe(0);
    });

    it('defers an order when its prepared predecessor cannot be verified', async () => {
      const { referee } = await seedPending();
      const row = (await repo.findReferralByReferee(referee))!;
      jest.spyOn(repo, 'prepareQualification').mockResolvedValue({ ...row, qualifyingOrderId: null });
      await expect(service.qualify(referee, randomUUID(), '')).rejects.toThrow('reversal pending');
      expect(loyalty.calls).toHaveLength(0);
    });

    it('does not report qualification when a void wins before the final update', async () => {
      const { referee } = await seedPending();
      jest.spyOn(repo, 'qualifyReferral').mockResolvedValue(null);
      await expect(service.qualify(referee, randomUUID(), '')).resolves.toEqual({ qualified: false });
    });

    it('qualifies without reward calls when both configured amounts are zero', async () => {
      const { referee } = await seedPending();
      service = new ReferralService(
        repo, loyalty, new FakeCustomerDirectory(),
        buildTestConfig({ REFERRAL_REFERRER_POINTS: '0', REFERRAL_REFEREE_POINTS: '0' }),
        new FakeOrderHistory(),
      );
      const result = await service.qualify(referee, randomUUID(), 'Bearer tkn');
      expect(result.qualified).toBe(true);
      expect(loyalty.calls).toHaveLength(0);
    });

    it('keeps the referral pending for a retry when a reward fails', async () => {
      const { referee } = await seedPending();
      loyalty.shouldThrow = true;

      await expect(service.qualify(referee, randomUUID(), 'Bearer tkn')).rejects.toThrow('loyalty down');
      loyalty.shouldThrow = false;
      service = new ReferralService(
        repo, loyalty, new FakeCustomerDirectory(),
        buildTestConfig({ REFERRAL_REFERRER_POINTS: '900' }), new FakeOrderHistory(),
      );
      const result = await service.qualify(referee, randomUUID(), 'Bearer tkn');
      expect(result.referral?.status).toBe(ReferralStatus.QUALIFIED);
      expect(result.referral?.referrerPoints).toBe(500);
      expect(loyalty.calls[0].idempotencyKey).toBe(loyalty.calls[1].idempotencyKey);
    });

    it('reuses the first reward key when the second reward fails', async () => {
      const { referrer, referee } = await seedPending();
      const reward = loyalty.reward.bind(loyalty);
      const spy = jest.spyOn(loyalty, 'reward').mockImplementation(async (...args) => {
        if (args[0] === referee) throw new Error('loyalty down');
        return reward(...args);
      });
      await expect(service.qualify(referee, randomUUID(), 'Bearer tkn')).rejects.toThrow('loyalty down');
      spy.mockRestore();

      const result = await service.qualify(referee, randomUUID(), 'Bearer tkn');
      expect(result.qualified).toBe(true);
      const referrerCalls = loyalty.calls.filter((call) => call.customerId === referrer);
      expect(referrerCalls).toHaveLength(2);
      expect(referrerCalls[0].idempotencyKey).toBe(referrerCalls[1].idempotencyKey);
    });

    it('reverses a voided qualification and allows the next order once', async () => {
      const { referee } = await seedPending();
      const voidedOrder = randomUUID();
      const nextOrder = randomUUID();
      const first = await service.qualify(referee, voidedOrder, '');
      await service.reverseForVoidedOrder(referee, voidedOrder);
      expect(loyalty.reversals).toHaveLength(4); // new keys plus legacy-key protection
      expect((await repo.findReferralByReferee(referee))?.status).toBe(ReferralStatus.PENDING);
      expect((await repo.findReferralByReferee(referee))?.qualifyingOrderId).toBeNull();
      const next = await service.qualify(referee, nextOrder, '');
      expect(next.qualified).toBe(true);
      expect(loyalty.calls.at(-1)?.idempotencyKey).toContain(nextOrder);
      expect(loyalty.calls.at(-1)?.idempotencyKey).not.toContain(voidedOrder);
      await service.reverseForVoidedOrder(referee, voidedOrder);
      expect((await repo.findReferralByReferee(referee))?.status).toBe(ReferralStatus.QUALIFIED);
      expect(first.referral?.id).toBe(next.referral?.id);
    });

    it('rechecks a qualification that lands while the void marker is written', async () => {
      const { referee } = await seedPending();
      const orderId = randomUUID();
      const mark = repo.markVoidedOrder.bind(repo);
      jest.spyOn(repo, 'markVoidedOrder').mockImplementation(async (referralId, voidedOrderId) => {
        const row = repo.referrals.find((r) => r.id === referralId)!;
        row.qualifyingOrderId = orderId;
        await mark(referralId, voidedOrderId);
      });
      await service.reverseForVoidedOrder(referee, orderId);
      expect(loyalty.reversals).toHaveLength(4);
      expect((await repo.findReferralByReferee(referee))?.qualifyingOrderId).toBeNull();
    });

    it('keeps the next order retryable while its predecessor is voided but not yet reversed', async () => {
      const { referee } = await seedPending();
      const oldOrder = randomUUID();
      const nextOrder = randomUUID();
      await service.qualify(referee, oldOrder, '');
      history.statuses.set(oldOrder, 'VOIDED');
      await expect(service.qualify(referee, nextOrder, '')).rejects.toThrow('reversal pending');
      await service.reverseForVoidedOrder(referee, oldOrder);
      await expect(service.qualify(referee, oldOrder, '')).resolves.toMatchObject({ qualified: false });
      await expect(service.qualify(referee, nextOrder, '')).resolves.toMatchObject({ qualified: true });
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
