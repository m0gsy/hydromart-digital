import { SettingsCache, SettingRow } from '@hydromart/platform';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ApplyEarningRuleDto } from '../../src/modules/dto/earning-rule.dto';
import { OrderRevenueDto } from '../../src/modules/dto/payout.dto';

import { ExpenseClaimService } from '../../src/application/services/expense-claim.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { CourierLedgerPrismaRepository } from '../../src/infrastructure/prisma/courier-ledger.prisma.repository';
import { SETTING_DEF_BY_KEY } from '../../src/config/setting-defs';
import type { PayoutConfigService } from '../../src/config/payout-config.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsRepository } from '../../src/application/ports/settings.repository';
import type {
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateCourierLedgerData,
} from '../../src/application/ports/courier-ledger.repository';
import type {
  CreateExpenseClaimData,
  ExpenseClaimRecord,
  ExpenseClaimRepository,
  ReviewExpenseClaimData,
} from '../../src/application/ports/expense-claim.repository';

// The paths the behaviour specs never take. Each one is a real decision the code makes, not a
// line count: a claim filed with no depot, an approval with no note, a retried credit, a value
// under the minimum, and a rule row whose tiers relation was not included.

class Ledger implements CourierLedgerRepository {
  entries: CourierLedgerEntryRecord[] = [];
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
  async balanceFor(): Promise<number> {
    return 0;
  }
  async sumByType(): Promise<number> {
    return 0;
  }
  async countByType(): Promise<number> {
    return 0;
  }
  async listForCourier() {
    return { items: [], total: 0 };
  }
  async currentRule() {
    return null;
  }
  async listRules() {
    return [];
  }
  createRule(): Promise<never> {
    throw new Error('not used');
  }
}

class Claims implements ExpenseClaimRepository {
  rows: ExpenseClaimRecord[] = [];
  async create(data: CreateExpenseClaimData): Promise<ExpenseClaimRecord> {
    const row: ExpenseClaimRecord = {
      id: `c-${this.rows.length}`,
      courierId: data.courierId,
      depotId: data.depotId,
      category: data.category,
      amount: data.amount,
      description: data.description,
      receiptUrl: data.receiptUrl ?? null,
      status: data.status,
      reviewedBy: data.reviewedBy ?? null,
      reviewedAt: data.reviewedAt ?? null,
      reviewNote: data.reviewNote ?? null,
      ledgerEntryId: data.ledgerEntryId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async findById(id: string): Promise<ExpenseClaimRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async markReviewed(id: string, data: ReviewExpenseClaimData): Promise<ExpenseClaimRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, {
      status: data.status,
      reviewedBy: data.reviewedBy,
      reviewNote: data.reviewNote,
      ledgerEntryId: data.ledgerEntryId ?? null,
      reviewedAt: new Date(),
    });
    return row;
  }
  async listForCourier() {
    return { items: [], total: 0 };
  }
  async searchForDepot() {
    return { items: [], total: 0 };
  }
}

const config = { expenseAutoApproveMaxIdr: () => 50_000 } as unknown as PayoutConfigService;

describe('ExpenseClaimService edges', () => {
  let ledger: Ledger;
  let claims: Claims;
  let service: ExpenseClaimService;

  beforeEach(() => {
    ledger = new Ledger();
    claims = new Claims();
    service = new ExpenseClaimService(claims, ledger, config);
  });

  it('files a claim with no depot as depotId null, not undefined', async () => {
    const claim = await service.submit('cou-1', {
      category: 'FUEL',
      amount: 10_000,
      description: 'Bensin',
      receiptUrl: 'https://x/r.jpg',
    });
    expect(claim.depotId).toBeNull();
    expect(claim.status).toBe('APPROVED');
  });

  it('records no review note when the reviewer left one out', async () => {
    const pending = await service.submit('cou-1', {
      category: 'FUEL',
      amount: 90_000, // over the threshold, so it waits for a reviewer
      description: 'Bensin',
      depotId: 'dep-1',
      receiptUrl: 'https://x/r.jpg',
    });
    const approved = await service.approve(pending.id, 'rev-1');
    expect(approved.reviewNote).toBeNull();
    expect(approved.reviewedBy).toBe('rev-1');
  });

  it('a retried approval reuses the existing ledger entry instead of paying twice', async () => {
    const pending = await service.submit('cou-1', {
      category: 'FUEL',
      amount: 90_000,
      description: 'Bensin',
      depotId: 'dep-1',
      receiptUrl: 'https://x/r.jpg',
    });
    // Simulate the first attempt having credited the courier before it failed to mark the claim.
    const already = await ledger.create({
      courierId: 'cou-1',
      depotId: 'dep-1',
      type: 'ADJUSTMENT',
      amount: 90_000,
      description: 'Klaim pengeluaran disetujui',
      sourceRef: `expense:${pending.id}`,
    });

    const approved = await service.approve(pending.id, 'rev-1', 'ok');

    expect(ledger.entries).toHaveLength(1);
    expect(approved.ledgerEntryId).toBe(already.id);
  });
});

describe('SettingsService edges', () => {
  const repoWith = (rows: SettingRow[]): SettingsRepository => {
    const store = [...rows] as (SettingRow & { updatedBy: string })[];
    return {
      loadAll: async () =>
        store.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value })),
      upsert: async (row) => {
        store.push(row);
      },
      remove: async () => undefined,
    };
  };

  it('rejects a value under the registry minimum', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({
        scope: 'GLOBAL',
        depotId: null,
        key: 'expenseAutoApproveMaxIdr',
        value: '-1',
        updatedBy: 'u1',
      }),
    ).rejects.toThrow(/below min/);
  });

  it('refuses a per-depot override of a global-only setting', async () => {
    // payout ships no global-only tunable today, so the guard is registered for the duration of
    // this test rather than left uncovered — the day one is added, this already protects it.
    SETTING_DEF_BY_KEY.networkOnlyKnob = {
      key: 'networkOnlyKnob',
      label: 'Global only',
      type: 'money',
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
});

describe('money DTOs coerce what an HTTP client actually sends', () => {
  // Query strings and JSON from a hand-rolled client arrive as strings. The @Type(() => Number)
  // factories are what turn them into numbers before @IsInt/@Min ever see them — untested, a
  // dropped decorator would let "abc" through as NaN on a rupiah field.
  it('parses a full earning rule, tier ladder included', () => {
    const dto = plainToInstance(ApplyEarningRuleDto, {
      baseFare: '5000',
      peakBonus: '1500',
      onTimeBonus: '500',
      peakStartHour: '17',
      peakEndHour: '20',
      monthlyTarget: '5000000',
      tiers: [{ deliveries: '25', bonus: '25000' }],
      effectiveDate: '2026-08-01',
    });

    expect(validateSync(dto as object)).toEqual([]);
    expect(dto.baseFare).toBe(5000);
    expect(dto.monthlyTarget).toBe(5_000_000);
    expect(dto.tiers?.[0]).toMatchObject({ deliveries: 25, bonus: 25_000 });
  });

  it('rejects a tier rung whose numbers are not numbers', () => {
    const dto = plainToInstance(ApplyEarningRuleDto, {
      baseFare: 5000,
      peakBonus: 1500,
      onTimeBonus: 500,
      peakStartHour: 17,
      peakEndHour: 20,
      tiers: [{ deliveries: 'banyak', bonus: 25_000 }],
      effectiveDate: '2026-08-01',
    });
    expect(validateSync(dto as object).map((e) => e.property)).toContain('tiers');
  });

  it('coerces the order amount a revenue callback posts as a string', () => {
    const dto = plainToInstance(OrderRevenueDto, {
      orderId: '11111111-1111-4111-8111-111111111111',
      // Required since the owner-credit rewrite: order-service resolves the depot's owner
      // before it posts, so a body without one is a caller bug, not a shape to accept.
      franchiseOwnerId: '22222222-2222-4222-8222-222222222222',
      amountIdr: '240000',
    });
    expect(validateSync(dto as object)).toEqual([]);
    expect(dto.amountIdr).toBe(240_000);
  });

  it('refuses a revenue callback that names no owner to credit', () => {
    const dto = plainToInstance(OrderRevenueDto, {
      orderId: '11111111-1111-4111-8111-111111111111',
      amountIdr: 240_000,
    });
    expect(validateSync(dto as object).map((e) => e.property)).toContain('franchiseOwnerId');
  });
});

describe('CourierLedgerPrismaRepository edges', () => {
  it('reads a rule whose tiers relation was not included as having no tiers', async () => {
    const ruleModel = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'rule-1',
        depotId: null,
        effectiveDate: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01'),
        baseFare: '5000',
        peakBonus: '1000',
        onTimeBonus: '500',
        peakStartHour: 17,
        peakEndHour: 20,
        monthlyTarget: '100',
        tiers: null,
      }),
      findMany: jest.fn(),
      create: jest.fn(),
    };
    const prisma = {
      courierLedgerEntry: {},
      courierEarningRule: ruleModel,
    } as unknown as PrismaService;

    const rule = await new CourierLedgerPrismaRepository(prisma).currentRule(null);

    expect(rule?.tiers).toEqual([]);
  });
});
