import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { SettingsCache } from '@hydromart/platform';

import { ApprovalService } from '../../src/application/services/approval.service';
import { DepotService } from '../../src/application/services/depot.service';
import { FranchiseApplicationService } from '../../src/application/services/franchise-application.service';
import { HandoverService } from '../../src/application/services/handover.service';
import { IncidentService } from '../../src/application/services/incident.service';
import { MaintenanceService } from '../../src/application/services/maintenance.service';
import { PriceOverrideService } from '../../src/application/services/price-override.service';
import { PricingService } from '../../src/application/services/pricing.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { WholesaleTierService } from '../../src/application/services/wholesale-tier.service';
import { MaintenanceItem, MaintenanceStatus } from '../../src/domain/maintenance';
import { FranchiseAppStage } from '../../src/domain/franchise-application';
import { IncidentStatus, isOpen } from '../../src/domain/incident';
import { PriceOverrideStatus } from '../../src/domain/price-override-proposal';
import {
  DepotNotFoundError,
  GallonOverReturnError,
  MaintenanceItemNotFoundError,
  PriceOverrideProposalDecidedError,
  PricingRuleNotFoundError,
  WholesaleTierNotFoundError,
} from '../../src/domain/errors';
import { SETTING_DEF_BY_KEY } from '../../src/config/setting-defs';
import {
  CreateMaintenanceData,
  MaintenanceRepository,
  UpdateMaintenanceData,
} from '../../src/application/ports/maintenance.repository';
import {
  buildTestConfig,
  InMemoryDepotRepository,
  InMemorySettingsRepository,
} from '../support/fakes';

/** The queue is what these tests are about; the names decorate it. */
const noNames = async () => new Map<string, string>();


const KNOWN_DEPOT = '11111111-1111-4111-8111-111111111111';

class InMemoryMaintenanceRepository implements MaintenanceRepository {
  rows: MaintenanceItem[] = [];
  async create(data: CreateMaintenanceData): Promise<MaintenanceItem> {
    const row: MaintenanceItem = {
      id: randomUUID(),
      ...data,
      status: MaintenanceStatus.HEALTHY,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return { ...row };
  }
  async listForDepot(depotId: string): Promise<MaintenanceItem[]> {
    return this.rows.filter((r) => r.depotId === depotId).map((r) => ({ ...r }));
  }
  async findById(id: string): Promise<MaintenanceItem | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async update(id: string, data: UpdateMaintenanceData): Promise<MaintenanceItem> {
    const rec = this.rows.find((x) => x.id === id)!;
    Object.assign(rec, data);
    return { ...rec };
  }
}

describe('MaintenanceService branch fills', () => {
  let repo: InMemoryMaintenanceRepository;
  let depots: InMemoryDepotRepository;
  let service: MaintenanceService;

  beforeEach(async () => {
    repo = new InMemoryMaintenanceRepository();
    depots = new InMemoryDepotRepository();
    service = new MaintenanceService(repo, depots);
    // Register a depot whose id we control so create/list pass the requireDepot guard.
    await depots.create({
      id: KNOWN_DEPOT,
      code: 'JKT-01',
      name: 'Depot',
      ownershipType: 'HKP' as never,
      address: 'a',
      city: 'c',
      province: 'p',
      lat: -6.1,
      lng: 106.8,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    } as never);
  });

  const anyDepot = () => (depots as unknown as { rows: { id: string }[] }).rows[0].id;

  it('creates and lists using the default `now` argument', async () => {
    const item = await service.create({
      depotId: anyDepot(),
      name: 'Motor',
      category: 'Kendaraan',
      intervalDays: 30,
      nextDueAt: new Date(),
    });
    expect(item.id).toBeDefined();
    const list = await service.list(anyDepot());
    expect(list).toHaveLength(1);
  });

  it('marks serviced with the default `now` argument', async () => {
    const item = await service.create({
      depotId: anyDepot(),
      name: 'Motor',
      category: 'Kendaraan',
      intervalDays: 30,
      nextDueAt: new Date(),
    });
    const serviced = await service.markServiced(item.id);
    expect(serviced.lastServicedAt).toBeInstanceOf(Date);
  });

  it('rejects create for an unknown depot', async () => {
    await expect(
      service.create({
        depotId: '00000000-0000-4000-8000-000000000000',
        name: 'x',
        category: 'c',
        intervalDays: 30,
        nextDueAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('rejects get/markServiced for an unknown id', async () => {
    await expect(service.get('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      MaintenanceItemNotFoundError,
    );
    await expect(
      service.markServiced('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(MaintenanceItemNotFoundError);
  });
});

// Every depot-scoped service refuses an unknown depot the same way, and every by-id getter
// raises its own not-found error. These are the guards that were only covered on some of them.
describe('depot-scoped guards and by-id getters', () => {
  const missing = { findById: async () => null, exists: async () => false } as never;
  const found = { findById: async () => ({ id: KNOWN_DEPOT }), exists: async () => true } as never;

  it('refuses an unknown depot on approval, handover and wholesale-tier writes', async () => {
    const approvals = new ApprovalService({} as never, missing, buildTestConfig());
    await expect(
      approvals.create({ depotId: KNOWN_DEPOT, amountIdr: 1 } as never, 'u'),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(approvals.list(KNOWN_DEPOT)).rejects.toBeInstanceOf(DepotNotFoundError);

    const handovers = new HandoverService({} as never, missing);
    await expect(handovers.list(KNOWN_DEPOT)).rejects.toBeInstanceOf(DepotNotFoundError);

    const tiers = new WholesaleTierService({} as never, missing);
    await expect(
      tiers.create({ depotId: KNOWN_DEPOT, label: 'l', minQty: 1, priceIdr: 1 } as never),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('loads one handover and one wholesale tier by id', async () => {
    const handover = { id: 'ho-1' };
    const handovers = new HandoverService({ findById: async () => handover } as never, found);
    expect(await handovers.get('ho-1')).toBe(handover);

    const tier = { id: 'wt-1' };
    const tiers = new WholesaleTierService({ findById: async () => tier } as never, found);
    expect(await tiers.get('wt-1')).toBe(tier);
    await expect(
      new WholesaleTierService({ findById: async () => null } as never, found).get('nope'),
    ).rejects.toBeInstanceOf(WholesaleTierNotFoundError);
  });

  it('clears the resolution fields when an incident is moved back off RESOLVED', async () => {
    const update = jest.fn().mockResolvedValue({});
    const incidents = new IncidentService(
      { findById: async () => ({ id: 'in-1' }), update } as never,
      found,
    );
    await incidents.updateStatus('in-1', IncidentStatus.IN_PROGRESS);
    expect(update).toHaveBeenCalledWith('in-1', {
      status: IncidentStatus.IN_PROGRESS,
      resolutionNote: null,
      resolvedBy: null,
      resolvedAt: null,
    });
  });

  it('patches a franchise application without touching an unsent checklist', async () => {
    const update = jest.fn().mockResolvedValue({});
    const apps = new FranchiseApplicationService(
      {
        findById: async () => ({ id: 'fa-1', stage: FranchiseAppStage.PENDING, checklist: {} }),
        update,
      } as never,
      { findByCode: async () => null } as never,
    );
    await apps.patch('fa-1', { stage: FranchiseAppStage.SURVEY });
    expect(update).toHaveBeenCalledWith('fa-1', {
      stage: FranchiseAppStage.SURVEY,
      checklist: undefined,
    });
  });

  // SOP §3: the sales broadcast must reach EVERY active depot, and browse clamps at 100.
  it('pages listAllActive past the browse cap and stops at the reported total', async () => {
    const page = (n: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `d-${n}-${i}` }) as never);
    const search = jest
      .fn()
      .mockResolvedValueOnce({ items: page(1, 100), total: 150 })
      .mockResolvedValueOnce({ items: page(2, 50), total: 150 });
    const svc = new DepotService({ search } as never);
    const out = await svc.listAllActive();
    expect(out).toHaveLength(150);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenNthCalledWith(1, { page: 1, limit: 100, activeOnly: true });
    expect(search).toHaveBeenNthCalledWith(2, { page: 2, limit: 100, activeOnly: true });
  });

  // A page that comes back empty must end the loop even if `total` disagrees, or a
  // miscounting repository spins forever inside a cron tick.
  it('stops on an empty page even when total overstates the count', async () => {
    const search = jest.fn().mockResolvedValue({ items: [], total: 999 });
    const svc = new DepotService({ search } as never);
    await expect(svc.listAllActive()).resolves.toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('falls back to 10 nearby depots when the caller sends limit 0', async () => {
    const search = jest.fn().mockResolvedValue({ items: [], total: 0 });
    await new DepotService({ search } as never).findNearby(-6.19, 106.84, 0);
    expect(search).toHaveBeenCalled();
  });
});

describe('PricingService not-found and empty-input branches', () => {
  const rules = { findById: jest.fn(), listActiveForDepot: jest.fn().mockResolvedValue([]) };
  const inventory = { findPrices: jest.fn().mockResolvedValue([]) };
  const tiers = { listForDepot: jest.fn().mockResolvedValue([]) };
  const service = new PricingService(
    rules as never,
    inventory as never,
    {} as never,
    tiers as never,
    buildTestConfig(),
  );

  beforeEach(() => jest.clearAllMocks());

  it('raises PricingRuleNotFound from get and remove', async () => {
    rules.findById.mockResolvedValue(null);
    await expect(service.get('nope')).rejects.toBeInstanceOf(PricingRuleNotFoundError);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(PricingRuleNotFoundError);
  });

  it('short-circuits an empty product list and defaults `now` to the current clock', async () => {
    expect(await service.resolvePrices(KNOWN_DEPOT, [])).toEqual([]);
    expect(inventory.findPrices).not.toHaveBeenCalled();
    await service.resolvePrices(KNOWN_DEPOT, ['prod-1']);
    expect(inventory.findPrices).toHaveBeenCalledWith(KNOWN_DEPOT, ['prod-1']);
  });
});

describe('PriceOverrideService', () => {
  const proposals = { findById: jest.fn(), countByProduct: jest.fn().mockResolvedValue([]) };
  const service = new PriceOverrideService(
    proposals as never,
    {} as never,
    {} as never,
    buildTestConfig(),
    noNames,
  );

  beforeEach(() => jest.clearAllMocks());

  it('defaults the per-product count to the PENDING queue', async () => {
    await service.countByProduct();
    expect(proposals.countByProduct).toHaveBeenCalledWith(PriceOverrideStatus.PENDING);
  });

  it('refuses to decide an already-decided proposal', async () => {
    proposals.findById.mockResolvedValue({ id: 'po-1', status: PriceOverrideStatus.APPROVED });
    await expect(service.approve('po-1', 'hq-1')).rejects.toBeInstanceOf(
      PriceOverrideProposalDecidedError,
    );
  });
});

describe('domain helpers', () => {
  it('words the deposit variant of an over-return distinctly from the gallon one', () => {
    expect(new GallonOverReturnError('deposit', 5000, 1000).message).toContain('Deposit refund');
    expect(new GallonOverReturnError('gallons', 5, 1).message).toContain('empties');
  });

  it('treats anything short of RESOLVED as still open', () => {
    expect(isOpen({ status: IncidentStatus.IN_PROGRESS })).toBe(true);
    expect(isOpen({ status: IncidentStatus.RESOLVED })).toBe(false);
  });
});

describe('SettingsService', () => {
  let repo: InMemorySettingsRepository;
  let service: SettingsService;

  beforeEach(() => {
    repo = new InMemorySettingsRepository();
    service = new SettingsService(repo as never, new SettingsCache(repo as never));
  });

  it('returns defs and effective values from the schema', async () => {
    const schema = await service.schema(null);
    expect(schema.defs.length).toBeGreaterThan(0);
    expect(schema.effective).toHaveProperty('gallonDepositIdr');
  });

  it('rejects an unknown setting key', async () => {
    await expect(
      service.put({ scope: 'GLOBAL', depotId: null, key: 'nope', value: '1', updatedBy: 'u' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a DEPOT override with no depotId', async () => {
    await expect(
      service.put({
        scope: 'DEPOT',
        depotId: null,
        key: 'gallonDepositIdr',
        value: '1',
        updatedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // No shipped def is global-only today, but the flag is part of the schema the console reads
  // (it hides the per-depot control) — the server has to reject the scope regardless.
  it('rejects a DEPOT override of a global-only setting', async () => {
    const def = SETTING_DEF_BY_KEY['gallonDepositIdr'];
    def.global = true;
    try {
      await expect(
        service.put({
          scope: 'DEPOT',
          depotId: 'd1',
          key: 'gallonDepositIdr',
          value: '1',
          updatedBy: 'u',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      delete def.global;
    }
  });

  it('rejects a value below the minimum and above the maximum', async () => {
    await expect(
      service.put({
        scope: 'GLOBAL',
        depotId: null,
        key: 'gallonDepositIdr',
        value: '-1',
        updatedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.put({
        scope: 'GLOBAL',
        depotId: null,
        key: 'gallonDepositIdr',
        value: '99999999',
        updatedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts a valid GLOBAL override and a DEPOT override', async () => {
    await service.put({
      scope: 'GLOBAL',
      depotId: null,
      key: 'gallonDepositIdr',
      value: '25000',
      updatedBy: 'u',
    });
    await service.put({
      scope: 'DEPOT',
      depotId: 'd1',
      key: 'gallonDepositIdr',
      value: '30000',
      updatedBy: 'u',
    });
    expect(repo.rows).toHaveLength(2);
    expect(repo.rows.find((r) => r.scope === 'GLOBAL')?.depotId).toBeNull();
  });

  it('resets a GLOBAL and a DEPOT override, rejecting a DEPOT reset with no depotId', async () => {
    await service.put({
      scope: 'GLOBAL',
      depotId: null,
      key: 'gallonDepositIdr',
      value: '25000',
      updatedBy: 'u',
    });
    await service.reset('GLOBAL', null, 'gallonDepositIdr');
    expect(repo.rows).toHaveLength(0);
    await service.reset('DEPOT', 'd1', 'gallonDepositIdr'); // no-op remove, exercises the depotId branch
    await expect(service.reset('DEPOT', null, 'gallonDepositIdr')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
