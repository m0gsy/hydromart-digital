import { RosterService } from '../../src/application/services/roster.service';
import { ShiftKind } from '../../src/domain/shift';
import { DepotNotFoundError } from '../../src/domain/errors';
import { DepotService } from '../../src/application/services/depot.service';
import { OwnershipType } from '../../src/domain/inventory';
import { InMemoryDepotRepository, InMemoryRosterRepository } from '../support/fakes';

const WEEK = '2026-07-14';
const STAFF = '33333333-3333-3333-3333-333333333333';

describe('RosterService', () => {
  let repo: InMemoryRosterRepository;
  let service: RosterService;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemoryRosterRepository();
    service = new RosterService(repo, depotRepo);
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

  it('returns only the requested depot+week cells', async () => {
    await service.setCell(depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.MORNING);
    await service.setCell(depotId, WEEK, STAFF, 'Budi', 1, ShiftKind.EVENING);
    await service.setCell(depotId, '2026-07-21', STAFF, 'Budi', 0, ShiftKind.OFF);

    const week = await service.week(depotId, WEEK);
    expect(week).toHaveLength(2);
    expect(week.map((c) => c.day).sort()).toEqual([0, 1]);
  });

  it('upserts a cell in place instead of duplicating (depot+week+staff+day is unique)', async () => {
    const first = await service.setCell(depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.MORNING);
    const second = await service.setCell(depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.EVENING);

    expect(second.id).toBe(first.id);
    expect(second.shift).toBe(ShiftKind.EVENING);
    const week = await service.week(depotId, WEEK);
    expect(week).toHaveLength(1);
  });

  it('bulk-sets many cells at once', async () => {
    const rows = await service.bulkSet(depotId, WEEK, [
      { staffId: STAFF, staffName: 'Budi', day: 0, shift: ShiftKind.MORNING },
      { staffId: STAFF, staffName: 'Budi', day: 2, shift: ShiftKind.OFF },
    ]);
    expect(rows).toHaveLength(2);
    expect(await service.week(depotId, WEEK)).toHaveLength(2);
  });

  it('rejects an unknown depot', async () => {
    await expect(
      service.week('00000000-0000-0000-0000-000000000000', WEEK),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });
});
