import {
  InsufficientBalanceError,
  InvalidEarningRuleError,
  InvalidWithdrawalAmountError,
} from '../src/domain/errors';
import type { WithdrawalStatus } from '../src/domain/ledger';
import { CourierPayoutService } from '../src/application/services/courier-payout.service';
import type { CourierLedgerEntryType } from '../src/domain/courier-earning';
import type {
  CourierEarningRuleRecord,
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateCourierLedgerData,
  CreateEarningRuleData,
} from '../src/application/ports/courier-ledger.repository';
import type {
  CourierWithdrawalRecord,
  CourierWithdrawalOutcome,
  CourierWithdrawalRepository,
  CreateCourierWithdrawalData,
} from '../src/application/ports/courier-withdrawal.repository';
import type { SettleWithdrawalOutcome } from '../src/application/ports/withdrawal.repository';
import { WithdrawalNotFoundError, WithdrawalNotProcessingError } from '../src/domain/errors';

const DEFAULT_RULE: CourierEarningRuleRecord = {
  id: 'rule-1',
  depotId: null,
  effectiveDate: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  baseFare: 5000,
  peakBonus: 2000,
  onTimeBonus: 1000,
  peakStartHour: 17,
  peakEndHour: 20,
  monthlyTarget: 5_000_000,
  tiers: [],
};

class FakeCourierLedger implements CourierLedgerRepository {
  entries: CourierLedgerEntryRecord[] = [];
  rule: CourierEarningRuleRecord | null = DEFAULT_RULE;

  async create(data: CreateCourierLedgerData): Promise<CourierLedgerEntryRecord> {
    const row: CourierLedgerEntryRecord = {
      id: `e-${this.entries.length}`,
      courierId: data.courierId,
      depotId: data.depotId,
      type: data.type,
      amount: data.amount,
      description: data.description,
      sourceRef: data.sourceRef ?? null,
      occurredAt: data.occurredAt ?? new Date(),
      createdAt: new Date(),
    };
    this.entries.push(row);
    return row;
  }
  async findBySourceRef(sourceRef: string): Promise<CourierLedgerEntryRecord | null> {
    return this.entries.find((e) => e.sourceRef === sourceRef) ?? null;
  }
  async balanceFor(courierId: string): Promise<number> {
    return this.entries.filter((e) => e.courierId === courierId).reduce((s, e) => s + e.amount, 0);
  }
  async sumByType(courierId: string, type: CourierLedgerEntryType, since: Date): Promise<number> {
    return this.entries
      .filter((e) => e.courierId === courierId && e.type === type && e.occurredAt >= since)
      .reduce((s, e) => s + e.amount, 0);
  }
  async listForCourier(courierId: string, page: number, limit: number) {
    const all = this.entries
      .filter((e) => e.courierId === courierId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async earningsByDepot(depotId: string, from: Date, to: Date) {
    const rows = new Map<
      string,
      { courierId: string; earnedIdr: number; paidDeliveries: number }
    >();
    for (const e of this.entries) {
      if (e.depotId !== depotId) continue;
      if (e.type !== 'EARNING' && e.type !== 'INCENTIVE') continue;
      if (e.occurredAt < from || e.occurredAt > to) continue;
      const row = rows.get(e.courierId) ?? {
        courierId: e.courierId,
        earnedIdr: 0,
        paidDeliveries: 0,
      };
      row.earnedIdr += e.amount;
      if (e.type === 'EARNING') row.paidDeliveries += 1;
      rows.set(e.courierId, row);
    }
    return [...rows.values()];
  }
  async countByType(
    courierId: string,
    type: CourierLedgerEntryType,
    since: Date,
    depotId?: string,
  ): Promise<number> {
    return this.entries.filter(
      (e) =>
        e.courierId === courierId &&
        e.type === type &&
        e.occurredAt >= since &&
        (depotId === undefined || e.depotId === depotId),
    ).length;
  }
  async currentRule(): Promise<CourierEarningRuleRecord | null> {
    return this.rule;
  }
  rules: CourierEarningRuleRecord[] = [];
  async listRules(): Promise<CourierEarningRuleRecord[]> {
    return this.rules;
  }
  deleted: string[] = [];
  async findRule(id: string): Promise<CourierEarningRuleRecord | null> {
    return this.rules.find((r) => r.id === id) ?? null;
  }
  async deleteRule(id: string): Promise<void> {
    this.deleted.push(id);
    this.rules = this.rules.filter((r) => r.id !== id);
  }
  async createRule(data: CreateEarningRuleData): Promise<CourierEarningRuleRecord> {
    const row: CourierEarningRuleRecord = {
      id: `r-${this.rules.length}`,
      createdAt: new Date(),
      ...data,
    };
    this.rules.push(row);
    return row;
  }
}

import { PayoutConfigService } from '../src/config/payout-config.service';

/** Only `businessTimeZone` is read; WIB is pinned so the peak-hour test cannot inherit
 * the host's zone and pass against a UTC-offset regression (H-16). */
const courierTestConfig = (timeZone = 'Asia/Jakarta'): PayoutConfigService =>
  ({ businessTimeZone: timeZone }) as PayoutConfigService;

class FakeCourierWithdrawals implements CourierWithdrawalRepository {
  private seq = 100_000;
  /** Mirrors the Postgres sequence: strictly increasing, never repeated (H-13). */
  async nextReferenceSequence(): Promise<number> {
    this.seq += 1;
    return this.seq;
  }

  created: CreateCourierWithdrawalData[] = [];

  // Reads the same ledger fake the real one aggregates over, so the balance cannot drift
  // into a second source of truth.
  constructor(private readonly ledger?: FakeCourierLedger) {}

  // Single-threaded stand-in for the advisory-locked withdraw (B-8/B-10): the check and
  // both writes are one step, a short balance writes nothing, and the debit carries the
  // sourceRef that makes a retry a no-op instead of a second debit.
  async withdrawWithDebit(input: {
    courierId: string;
    amount: number;
    bankAccountRef: string;
    reference: string;
    status: WithdrawalStatus;
    description: string;
  }): Promise<CourierWithdrawalOutcome> {
    const balance = (await this.ledger?.balanceFor(input.courierId)) ?? 0;
    if (input.amount > balance) return { ok: false, balance };

    const withdrawal = await this.create({
      courierId: input.courierId,
      amount: input.amount,
      bankAccountRef: input.bankAccountRef,
      reference: input.reference,
      status: input.status,
    });
    await this.ledger?.create({
      courierId: input.courierId,
      depotId: null,
      type: 'WITHDRAWAL',
      amount: -input.amount,
      description: input.description,
      sourceRef: `withdrawal:${input.reference}`,
    });
    return { ok: true, withdrawal };
  }

  /** Written rows by id — `settle` has to find one and refuse to settle it twice. */
  rows = new Map<string, CourierWithdrawalRecord>();

  async create(data: CreateCourierWithdrawalData): Promise<CourierWithdrawalRecord> {
    this.created.push(data);
    const row = {
      ...data,
      id: `w-${this.created.length}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(row.id, row);
    return row;
  }
  async listForCourier(courierId: string): Promise<CourierWithdrawalRecord[]> {
    return this.created
      .filter((w) => w.courierId === courierId)
      .map((w, i) => ({ ...w, id: `w-${i}`, createdAt: new Date(), updatedAt: new Date() }));
  }
  async listProcessing(limit: number): Promise<CourierWithdrawalRecord[]> {
    return [...this.rows.values()].filter((r) => r.status === 'PROCESSING').slice(0, limit);
  }

  // Same contract as the real transaction: the status guard and the compensating credit
  // are one step, so a second FAILED cannot credit again.
  async settle(input: {
    id: string;
    status: 'PAID' | 'FAILED';
    reversal: { sourceRef: string; description: string };
  }): Promise<SettleWithdrawalOutcome<CourierWithdrawalRecord>> {
    const row = this.rows.get(input.id);
    if (!row) return { ok: false, reason: 'NOT_FOUND' };
    if (row.status !== 'PROCESSING') {
      return { ok: false, reason: 'NOT_PROCESSING', status: row.status };
    }
    const settled = { ...row, status: input.status as WithdrawalStatus, updatedAt: new Date() };
    this.rows.set(row.id, settled);
    if (input.status === 'FAILED') {
      await this.ledger?.create({
        courierId: row.courierId,
        depotId: null,
        type: 'ADJUSTMENT',
        amount: row.amount,
        description: input.reversal.description,
        sourceRef: input.reversal.sourceRef,
      });
    }
    return { ok: true, withdrawal: settled };
  }
}

const COURIER = '11111111-1111-4111-8111-111111111111';
// 18:00 WIB = 11:00 UTC → peak; 03:00 UTC = 10:00 WIB → off-peak.
const PEAK_UTC = '2026-07-18T11:00:00.000Z';
const OFFPEAK_UTC = '2026-07-18T03:00:00.000Z';

const event = (
  deliveryId: string,
  deliveredAt: string,
  onTime: boolean,
  depotId: string | null = null,
) => ({
  courierId: COURIER,
  depotId,
  deliveryId,
  deliveredAt,
  onTime,
});

describe('CourierPayoutService', () => {
  let ledger: FakeCourierLedger;
  let withdrawals: FakeCourierWithdrawals;
  let service: CourierPayoutService;

  beforeEach(() => {
    ledger = new FakeCourierLedger();
    withdrawals = new FakeCourierWithdrawals(ledger);
    service = new CourierPayoutService(ledger, withdrawals, courierTestConfig());
  });

  it('credits base + on-time + peak using the WIB hour of deliveredAt', async () => {
    const entry = await service.recordDeliveryEarning(event('d1', PEAK_UTC, true));
    expect(entry?.type).toBe('EARNING');
    expect(entry?.amount).toBe(8000); // 5000 + 2000 peak + 1000 on-time
  });

  /*
   * The way out of PROCESSING, courier side.
   *
   * The audit reported this one against the courier path and its own rebuttal named the
   * franchise path as sharing the defect. It is one change: a courier's balance drops the
   * moment they tap "Tarik saldo", and until now PROCESSING was the last state that money
   * ever reached — nothing could say whether the transfer arrived, and a rejected one kept
   * the courier's money.
   */
  describe('settleWithdrawal', () => {
    const cashOut = async () => {
      await ledger.create({
        courierId: COURIER,
        depotId: null,
        type: 'EARNING',
        amount: 300000,
        description: 'seed',
        sourceRef: 'seed-1',
      });
      return service.requestWithdrawal(COURIER, 120000, 'BCA ···· 4821');
    };

    it('marks a cleared transfer PAID without touching the balance again', async () => {
      const w = await cashOut();
      expect(await ledger.balanceFor(COURIER)).toBe(180000);
      expect((await service.settleWithdrawal(w.id, 'PAID', 'finance-1')).status).toBe('PAID');
      expect(await ledger.balanceFor(COURIER)).toBe(180000);
    });

    it('gives the courier their money back when the bank rejects it', async () => {
      const w = await cashOut();
      const failed = await service.settleWithdrawal(w.id, 'FAILED', 'finance-1', 'Rekening salah');
      expect(failed.status).toBe('FAILED');
      expect(await ledger.balanceFor(COURIER)).toBe(300000);
      expect(await ledger.findBySourceRef(`withdrawal-reversal:${w.id}`)).toMatchObject({
        type: 'ADJUSTMENT',
        amount: 120000,
      });
    });

    it('refuses a second settlement, so the reversal cannot pay twice', async () => {
      const w = await cashOut();
      await service.settleWithdrawal(w.id, 'FAILED', 'finance-1');
      await expect(service.settleWithdrawal(w.id, 'PAID', 'finance-1')).rejects.toBeInstanceOf(
        WithdrawalNotProcessingError,
      );
      expect(await ledger.balanceFor(COURIER)).toBe(300000);
    });

    it('404s on a withdrawal that does not exist', async () => {
      await expect(service.settleWithdrawal('w-nope', 'PAID', 'finance-1')).rejects.toBeInstanceOf(
        WithdrawalNotFoundError,
      );
    });

    it('lists what is still waiting on the bank, and drops each one as it is answered', async () => {
      const w = await cashOut();
      expect(await service.listProcessingWithdrawals()).toHaveLength(1);
      await service.settleWithdrawal(w.id, 'PAID', 'finance-1');
      expect(await service.listProcessingWithdrawals()).toHaveLength(0);
    });
  });

  /*
   * E-1. delivery-service's commission report reads this instead of multiplying its own
   * delivery count by its own flat rate — the rate that disagreed with what was actually
   * paid. Scoped to the depot: money earned elsewhere is not this depot's commission run.
   */
  it("answers a depot's paid earnings from the ledger the courier is actually paid from", async () => {
    const depot = '00000000-0000-4000-8000-0000000000d1';
    const elsewhere = '00000000-0000-4000-8000-0000000000d2';
    await service.recordDeliveryEarning(event('d-a', PEAK_UTC, true, depot));
    await service.recordDeliveryEarning(event('d-b', OFFPEAK_UTC, false, depot));
    await service.recordDeliveryEarning(event('d-c', OFFPEAK_UTC, false, elsewhere));

    const rows = await service.earningsByDepot(
      depot,
      new Date('2000-01-01T00:00:00.000Z'),
      new Date('2100-01-01T00:00:00.000Z'),
    );

    // 8000 (peak + on-time) + 5000 (base). The delivery at the other depot is not here.
    expect(rows).toEqual([{ courierId: COURIER, earnedIdr: 13000, paidDeliveries: 2 }]);
  });

  it('credits base only for an off-peak, late delivery', async () => {
    const entry = await service.recordDeliveryEarning(event('d2', OFFPEAK_UTC, false));
    expect(entry?.amount).toBe(5000);
  });

  it('is idempotent: a re-pushed delivery posts no second entry', async () => {
    await service.recordDeliveryEarning(event('d3', OFFPEAK_UTC, true));
    await service.recordDeliveryEarning(event('d3', OFFPEAK_UTC, true));
    expect(ledger.entries).toHaveLength(1);
    expect(await service.summary(COURIER)).toMatchObject({ availableBalance: 6000 });
  });

  it('records nothing when no earning rule is configured', async () => {
    ledger.rule = null;
    const entry = await service.recordDeliveryEarning(event('d4', PEAK_UTC, true));
    expect(entry).toBeNull();
    expect(ledger.entries).toHaveLength(0);
  });

  it('summary sums this-month earnings and the balance', async () => {
    await service.recordDeliveryEarning(event('d5', OFFPEAK_UTC, true)); // 6000
    await service.recordDeliveryEarning(event('d6', PEAK_UTC, false)); // 7000
    const summary = await service.summary(COURIER);
    expect(summary.availableBalance).toBe(13000);
    expect(summary.recentEntries).toHaveLength(2);
  });

  describe('recordCashVariance', () => {
    const variance = (settlementId: string, amount: number) => ({
      courierId: COURIER,
      depotId: null,
      settlementId,
      amount,
    });

    it('posts a negative CASH_VARIANCE debit for a shortfall', async () => {
      const entry = await service.recordCashVariance(variance('s1', 15000));
      expect(entry.type).toBe('CASH_VARIANCE');
      expect(entry.amount).toBe(-15000);
      expect(await ledger.balanceFor(COURIER)).toBe(-15000);
    });

    it('is idempotent per settlement id', async () => {
      await service.recordCashVariance(variance('s2', 15000));
      await service.recordCashVariance(variance('s2', 15000));
      expect(ledger.entries).toHaveLength(1);
    });
  });

  describe('requestWithdrawal', () => {
    it('rejects a non-positive amount', async () => {
      await expect(service.requestWithdrawal(COURIER, 0, 'BCA')).rejects.toBeInstanceOf(
        InvalidWithdrawalAmountError,
      );
    });

    it('rejects when the amount exceeds available balance', async () => {
      await service.recordDeliveryEarning(event('d1', OFFPEAK_UTC, false)); // 5000 balance
      await expect(service.requestWithdrawal(COURIER, 6000, 'BCA')).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );
    });

    it('posts a matching debit that drops the balance to zero on a full cash-out', async () => {
      await service.recordDeliveryEarning(event('d1', PEAK_UTC, true)); // 8000
      const w = await service.requestWithdrawal(COURIER, 8000, 'BCA ···· 4821');
      expect(w.reference).toMatch(/^WD-\d{8}-\d{4,}$/);
      expect(withdrawals.created).toHaveLength(1);
      expect(await ledger.balanceFor(COURIER)).toBe(0);
      expect((await service.summary(COURIER)).recentWithdrawals).toHaveLength(1);
    });
  });

  describe('ledger + withdrawal history', () => {
    it('paginates the courier ledger', async () => {
      await service.recordDeliveryEarning(event('d1', OFFPEAK_UTC, false)); // 5000
      await service.recordDeliveryEarning(event('d2', OFFPEAK_UTC, false)); // 5000
      const page = await service.ledgerPage(COURIER, 1, 1);
      expect(page).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
      expect(page.items).toHaveLength(1);
    });

    it('returns the withdrawal history for the courier', async () => {
      await service.recordDeliveryEarning(event('d1', PEAK_UTC, true)); // 8000
      await service.requestWithdrawal(COURIER, 8000, 'BCA');
      const history = await service.withdrawalHistory(COURIER);
      expect(history).toHaveLength(1);
      expect(history[0].amount).toBe(8000);
    });
  });

  describe('earning-rule editor (design 6b)', () => {
    const validRule = {
      depotId: null,
      baseFare: 5000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      monthlyTarget: 5_000_000,
      tiers: [{ deliveries: 25, bonus: 25_000 }],
      effectiveDate: new Date('2026-08-01'),
    };

    it('appends a rule and lists it back', async () => {
      const created = await service.applyEarningRule(validRule);
      expect(created.id).toBeDefined();
      expect(await service.listEarningRules()).toHaveLength(1);
    });

    /*
     * Append-only protects HISTORY, not mistakes that have not cost anything yet.
     *
     * Before this there was no delete at all, so a rule typed with the wrong year could
     * never be removed — and because the query beside it ignored the date entirely, that
     * rule was also the one paying couriers. Production had one dated 2030.
     */
    it('deletes a rule whose effective date has not arrived', async () => {
      const created = await service.applyEarningRule({
        ...validRule,
        effectiveDate: new Date('2030-01-19'),
      });
      await service.deleteScheduledRule(created.id, new Date('2026-08-31'));
      expect(ledger.deleted).toEqual([created.id]);
      expect(await service.listEarningRules()).toHaveLength(0);
    });

    it('refuses to delete a rule that has already taken effect', async () => {
      const created = await service.applyEarningRule({
        ...validRule,
        effectiveDate: new Date('2026-01-01'),
      });
      await expect(service.deleteScheduledRule(created.id, new Date('2026-08-31'))).rejects.toThrow(
        /already taken effect/,
      );
      expect(ledger.deleted).toEqual([]);
    });

    // The boundary itself: effective TODAY is in force, not scheduled.
    it('refuses a rule effective at exactly the moment asked about', async () => {
      const now = new Date('2026-08-31T00:00:00.000Z');
      const created = await service.applyEarningRule({ ...validRule, effectiveDate: now });
      await expect(service.deleteScheduledRule(created.id, now)).rejects.toThrow(
        /already taken effect/,
      );
    });

    it('reports an id that is not there rather than silently succeeding', async () => {
      await expect(
        service.deleteScheduledRule('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(/not found/);
    });

    it('rejects a negative fare', async () => {
      await expect(service.applyEarningRule({ ...validRule, baseFare: -1 })).rejects.toBeInstanceOf(
        InvalidEarningRuleError,
      );
    });

    it('rejects an empty peak window (start ≥ end)', async () => {
      await expect(
        service.applyEarningRule({ ...validRule, peakStartHour: 20, peakEndHour: 17 }),
      ).rejects.toBeInstanceOf(InvalidEarningRuleError);
    });

    it('rejects a negative monthly target', async () => {
      await expect(
        service.applyEarningRule({ ...validRule, monthlyTarget: -1 }),
      ).rejects.toBeInstanceOf(InvalidEarningRuleError);
    });

    it('rejects a ladder with duplicate delivery counts', async () => {
      await expect(
        service.applyEarningRule({
          ...validRule,
          tiers: [
            { deliveries: 25, bonus: 1 },
            { deliveries: 25, bonus: 2 },
          ],
        }),
      ).rejects.toBeInstanceOf(InvalidEarningRuleError);
    });

    it('exposes the effective rule to the courier', async () => {
      expect(await service.effectiveRule(null)).toBe(DEFAULT_RULE);
    });
  });

  describe('monthly incentive tiers', () => {
    // Same-month deliveries; the 2nd one crosses the 2-delivery rung.
    const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}T03:00:00.000Z`;

    beforeEach(() => {
      ledger.rule = {
        ...DEFAULT_RULE,
        tiers: [
          { deliveries: 2, bonus: 25_000 },
          { deliveries: 3, bonus: 60_000 },
        ],
      };
    });

    const incentives = () => ledger.entries.filter((e) => e.type === 'INCENTIVE');

    // C2: the incentive month is the courier's month, in WIB. `startOfMonth` used the
    // SERVER's calendar — UTC on the box — so a delivery made on 1 August at 02:00 WIB
    // (31 July 19:00 UTC) counted against July's tally and, once August's own deliveries
    // arrived, could pay the same rung twice or never.
    it('counts a delivery just after local midnight into the LOCAL month', async () => {
      // 31 Jul 19:00 UTC = 1 Aug 02:00 WIB.
      await service.recordDeliveryEarning(event('d1', '2026-07-31T19:00:00.000Z', true));
      await service.recordDeliveryEarning(event('d2', '2026-08-01T05:00:00.000Z', true));
      expect(incentives()).toHaveLength(1);
      // Both deliveries are August's, so the rung is August's rung.
      expect(incentives()[0].sourceRef).toContain(':2026-08:2');
    });

    it('posts nothing before the first rung is reached', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      expect(incentives()).toHaveLength(0);
    });

    it('credits the rung bonus on the delivery that reaches it', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      expect(incentives()).toHaveLength(1);
      expect(incentives()[0].amount).toBe(25_000);
      expect(incentives()[0].sourceRef).toContain(':2026-07:2');
    });

    it('pays each rung once even as later deliveries land', async () => {
      for (const id of ['d1', 'd2', 'd3', 'd4']) {
        await service.recordDeliveryEarning(event(id, day(Number(id.slice(1))), true));
      }
      expect(incentives().map((e) => e.amount)).toEqual([25_000, 60_000]);
    });

    it('is idempotent when a delivery is re-pushed', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      expect(incentives()).toHaveLength(1);
    });

    /**
     * `applyEarningRule` APPENDS a rule row rather than editing one, so the rule in force gets
     * a new id whenever HQ touches the ladder. The incentive key carried that id, which made
     * every rung already paid this month look unpaid the moment the ladder was re-applied — a
     * courier at the 2-delivery rung got its bonus a second time on their next delivery.
     */
    it('does not re-pay a rung when the ladder is re-applied mid-month', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      await service.recordDeliveryEarning(event('d2', day(2), true)); // rung 2 paid
      expect(incentives()).toHaveLength(1);

      // HQ re-applies the same ladder: a new rule row, hence a new rule id.
      ledger.rule = { ...ledger.rule!, id: 'rule-v2' };
      await service.recordDeliveryEarning(event('d3', day(3), true)); // rung 3 is new, 2 is not

      expect(incentives().map((e) => e.amount)).toEqual([25_000, 60_000]);
    });

    /**
     * The ladder belongs to a depot's earning rule and that depot pays the bonus, but the tally
     * counted every depot the courier worked: 1 delivery at depot A plus 1 at depot B fired
     * depot B's 2-delivery rung on the second COMBINED delivery, with depot B paying for depot
     * A's work. Counted per depot now, and each depot's rung is keyed separately so a courier
     * can legitimately earn both.
     */
    it('does not walk one depot ladder up with another depot deliveries', async () => {
      await service.recordDeliveryEarning(event('a1', day(1), true, 'depot-a'));
      await service.recordDeliveryEarning(event('b1', day(2), true, 'depot-b'));
      // One delivery each: neither depot has reached its own 2-delivery rung.
      expect(incentives()).toHaveLength(0);

      await service.recordDeliveryEarning(event('b2', day(3), true, 'depot-b'));
      expect(incentives()).toHaveLength(1);
      expect(incentives()[0].sourceRef).toContain(':depot-b:');
      expect(incentives()[0].depotId).toBe('depot-b');
    });

    it('lets each depot pay its own rung for the same courier and month', async () => {
      for (const id of ['a1', 'a2']) {
        await service.recordDeliveryEarning(event(id, day(1), true, 'depot-a'));
      }
      for (const id of ['b1', 'b2']) {
        await service.recordDeliveryEarning(event(id, day(2), true, 'depot-b'));
      }
      const refs = incentives().map((e) => e.sourceRef);
      expect(refs).toEqual([
        expect.stringContaining(':depot-a:2026-07:2'),
        expect.stringContaining(':depot-b:2026-07:2'),
      ]);
    });

    it('restarts the ladder in a new month', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      await service.recordDeliveryEarning(event('a1', '2026-08-01T03:00:00.000Z', true));
      await service.recordDeliveryEarning(event('a2', '2026-08-02T03:00:00.000Z', true));
      const refs = incentives().map((e) => e.sourceRef);
      expect(refs).toEqual([
        expect.stringContaining(':2026-07:2'),
        expect.stringContaining(':2026-08:2'),
      ]);
    });
  });
});
