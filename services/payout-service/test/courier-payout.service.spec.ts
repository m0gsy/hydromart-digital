import { CourierPayoutService } from '../src/application/services/courier-payout.service';
import type { CourierEarningRule, CourierLedgerEntryType } from '../src/domain/courier-earning';
import type {
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateCourierLedgerData,
} from '../src/application/ports/courier-ledger.repository';

const DEFAULT_RULE: CourierEarningRule = {
  baseFare: 5000,
  peakBonus: 2000,
  onTimeBonus: 1000,
  peakStartHour: 17,
  peakEndHour: 20,
};

class FakeCourierLedger implements CourierLedgerRepository {
  entries: CourierLedgerEntryRecord[] = [];
  rule: CourierEarningRule | null = DEFAULT_RULE;

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
  async sumByType(
    courierId: string,
    type: CourierLedgerEntryType,
    since: Date,
  ): Promise<number> {
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
  async currentRule(): Promise<CourierEarningRule | null> {
    return this.rule;
  }
}

const COURIER = '11111111-1111-4111-8111-111111111111';
// 18:00 WIB = 11:00 UTC → peak; 03:00 UTC = 10:00 WIB → off-peak.
const PEAK_UTC = '2026-07-18T11:00:00.000Z';
const OFFPEAK_UTC = '2026-07-18T03:00:00.000Z';

const event = (deliveryId: string, deliveredAt: string, onTime: boolean) => ({
  courierId: COURIER,
  depotId: null,
  deliveryId,
  deliveredAt,
  onTime,
});

describe('CourierPayoutService', () => {
  let ledger: FakeCourierLedger;
  let service: CourierPayoutService;

  beforeEach(() => {
    ledger = new FakeCourierLedger();
    service = new CourierPayoutService(ledger);
  });

  it('credits base + on-time + peak using the WIB hour of deliveredAt', async () => {
    const entry = await service.recordDeliveryEarning(event('d1', PEAK_UTC, true));
    expect(entry?.type).toBe('EARNING');
    expect(entry?.amount).toBe(8000); // 5000 + 2000 peak + 1000 on-time
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
});
