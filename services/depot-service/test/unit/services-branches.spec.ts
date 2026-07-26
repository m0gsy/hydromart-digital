import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { SettingsCache } from '@hydromart/platform';

import { MaintenanceService } from '../../src/application/services/maintenance.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { MaintenanceItem, MaintenanceStatus } from '../../src/domain/maintenance';
import { DepotNotFoundError, MaintenanceItemNotFoundError } from '../../src/domain/errors';
import {
  CreateMaintenanceData,
  MaintenanceRepository,
  UpdateMaintenanceData,
} from '../../src/application/ports/maintenance.repository';
import { InMemoryDepotRepository, InMemorySettingsRepository } from '../support/fakes';

const KNOWN_DEPOT = '11111111-1111-4111-8111-111111111111';

class InMemoryMaintenanceRepository implements MaintenanceRepository {
  rows: MaintenanceItem[] = [];
  async create(data: CreateMaintenanceData): Promise<MaintenanceItem> {
    const row: MaintenanceItem = {
      id: randomUUID(), ...data, status: MaintenanceStatus.HEALTHY, createdAt: new Date(), updatedAt: new Date(),
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
      id: KNOWN_DEPOT, code: 'JKT-01', name: 'Depot', ownershipType: 'HKP' as never,
      address: 'a', city: 'c', province: 'p', lat: -6.1, lng: 106.8, serviceRadiusKm: 5,
      deliveryFee: 5000, minOrderAmount: null, ownerId: null, operatingHours: {}, holidays: [],
    } as never);
  });

  const anyDepot = () => (depots as unknown as { rows: { id: string }[] }).rows[0].id;

  it('creates and lists using the default `now` argument', async () => {
    const item = await service.create({
      depotId: anyDepot(), name: 'Motor', category: 'Kendaraan', intervalDays: 30, nextDueAt: new Date(),
    });
    expect(item.id).toBeDefined();
    const list = await service.list(anyDepot());
    expect(list).toHaveLength(1);
  });

  it('marks serviced with the default `now` argument', async () => {
    const item = await service.create({
      depotId: anyDepot(), name: 'Motor', category: 'Kendaraan', intervalDays: 30, nextDueAt: new Date(),
    });
    const serviced = await service.markServiced(item.id);
    expect(serviced.lastServicedAt).toBeInstanceOf(Date);
  });

  it('rejects create for an unknown depot', async () => {
    await expect(service.create({
      depotId: '00000000-0000-4000-8000-000000000000', name: 'x', category: 'c', intervalDays: 30, nextDueAt: new Date(),
    })).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('rejects get/markServiced for an unknown id', async () => {
    await expect(service.get('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(MaintenanceItemNotFoundError);
    await expect(service.markServiced('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(MaintenanceItemNotFoundError);
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
    await expect(service.put({ scope: 'GLOBAL', depotId: null, key: 'nope', value: '1', updatedBy: 'u' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a DEPOT override with no depotId', async () => {
    await expect(service.put({ scope: 'DEPOT', depotId: null, key: 'gallonDepositIdr', value: '1', updatedBy: 'u' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a value below the minimum and above the maximum', async () => {
    await expect(service.put({ scope: 'GLOBAL', depotId: null, key: 'gallonDepositIdr', value: '-1', updatedBy: 'u' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.put({ scope: 'GLOBAL', depotId: null, key: 'gallonDepositIdr', value: '99999999', updatedBy: 'u' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('upserts a valid GLOBAL override and a DEPOT override', async () => {
    await service.put({ scope: 'GLOBAL', depotId: null, key: 'gallonDepositIdr', value: '25000', updatedBy: 'u' });
    await service.put({ scope: 'DEPOT', depotId: 'd1', key: 'gallonDepositIdr', value: '30000', updatedBy: 'u' });
    expect(repo.rows).toHaveLength(2);
    expect(repo.rows.find((r) => r.scope === 'GLOBAL')?.depotId).toBeNull();
  });

  it('resets a GLOBAL and a DEPOT override, rejecting a DEPOT reset with no depotId', async () => {
    await service.put({ scope: 'GLOBAL', depotId: null, key: 'gallonDepositIdr', value: '25000', updatedBy: 'u' });
    await service.reset('GLOBAL', null, 'gallonDepositIdr');
    expect(repo.rows).toHaveLength(0);
    await service.reset('DEPOT', 'd1', 'gallonDepositIdr'); // no-op remove, exercises the depotId branch
    await expect(service.reset('DEPOT', null, 'gallonDepositIdr')).rejects.toBeInstanceOf(BadRequestException);
  });
});
