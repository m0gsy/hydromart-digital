import { randomUUID } from 'node:crypto';

import { MaintenanceService } from '../../src/application/services/maintenance.service';
import {
  deriveMaintenanceStatus,
  MaintenanceItem,
  MaintenanceStatus,
} from '../../src/domain/maintenance';
import { MaintenanceItemNotFoundError } from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import {
  CreateMaintenanceData,
  MaintenanceRepository,
  UpdateMaintenanceData,
} from '../../src/application/ports/maintenance.repository';
import { InMemoryDepotRepository } from '../support/fakes';

// Local in-memory MaintenanceRepository (do not edit shared fakes.ts). Stores the
// prisma default HEALTHY column; the service always recomputes status on read.
class InMemoryMaintenanceRepository implements MaintenanceRepository {
  rows: MaintenanceItem[] = [];
  private seq = 0;
  private next(): Date {
    return new Date(1_800_000_000_000 + (this.seq += 1) * 1000);
  }

  async create(data: CreateMaintenanceData): Promise<MaintenanceItem> {
    const at = this.next();
    const row: MaintenanceItem = {
      id: randomUUID(),
      ...data,
      status: MaintenanceStatus.HEALTHY,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(row);
    return { ...row };
  }
  async listForDepot(depotId: string): Promise<MaintenanceItem[]> {
    return this.rows
      .filter((r) => r.depotId === depotId)
      .sort((a, b) => a.nextDueAt.getTime() - b.nextDueAt.getTime())
      .map((r) => ({ ...r }));
  }
  async findById(id: string): Promise<MaintenanceItem | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async update(id: string, data: UpdateMaintenanceData): Promise<MaintenanceItem> {
    const rec = this.rows.find((x) => x.id === id)!;
    Object.assign(rec, data, { updatedAt: this.next() });
    return { ...rec };
  }
}

const NOW = new Date('2026-07-18T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

describe('deriveMaintenanceStatus', () => {
  it('is DUE when next-due is at or before now', () => {
    expect(deriveMaintenanceStatus(days(-1), null, NOW)).toBe(MaintenanceStatus.DUE);
    expect(deriveMaintenanceStatus(NOW, null, NOW)).toBe(MaintenanceStatus.DUE);
  });
  it('is SOON when next-due falls within the soon window', () => {
    expect(deriveMaintenanceStatus(days(10), null, NOW)).toBe(MaintenanceStatus.SOON);
    expect(deriveMaintenanceStatus(days(14), null, NOW)).toBe(MaintenanceStatus.SOON);
  });
  it('is NEW when freshly serviced and not yet due', () => {
    expect(deriveMaintenanceStatus(days(30), days(-3), NOW)).toBe(MaintenanceStatus.NEW);
  });
  it('is HEALTHY when far from due and not freshly serviced', () => {
    expect(deriveMaintenanceStatus(days(30), days(-40), NOW)).toBe(MaintenanceStatus.HEALTHY);
    expect(deriveMaintenanceStatus(days(30), null, NOW)).toBe(MaintenanceStatus.HEALTHY);
  });
});

describe('MaintenanceService', () => {
  let repo: InMemoryMaintenanceRepository;
  let service: MaintenanceService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryMaintenanceRepository();
    service = new MaintenanceService(repo, depotRepo);
    const depot = await new DepotService(depotRepo).create({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: OwnershipType.HKP,
      address: 'a',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.19,
      lng: 106.84,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    depotId = depot.id;
  });

  const add = (nextDueAt: Date, intervalDays = 30) =>
    service.create(
      { depotId, name: 'Motor B 1234', category: 'Kendaraan', intervalDays, nextDueAt },
      NOW,
    );

  it('recomputes derived status on list, ordered by next-due asc', async () => {
    await add(days(30)); // HEALTHY
    await add(days(-1)); // DUE
    await add(days(5)); // SOON
    const items = await service.list(depotId, NOW);
    expect(items.map((i) => i.status)).toEqual([
      MaintenanceStatus.DUE,
      MaintenanceStatus.SOON,
      MaintenanceStatus.HEALTHY,
    ]);
  });

  it('marks serviced now and bumps next-due by intervalDays', async () => {
    const item = await add(days(-1), 30); // overdue
    const serviced = await service.markServiced(item.id, NOW);
    expect(serviced.lastServicedAt).toEqual(NOW);
    expect(serviced.nextDueAt).toEqual(days(30));
    // Freshly serviced, far from due → NEW.
    expect(serviced.status).toBe(MaintenanceStatus.NEW);
  });

  it('rejects an unknown id on serviced', async () => {
    await expect(
      service.markServiced('00000000-0000-0000-0000-000000000000', NOW),
    ).rejects.toBeInstanceOf(MaintenanceItemNotFoundError);
  });
});
