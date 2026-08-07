import { RosterService } from '../../src/application/services/roster.service';
import { ShiftKind } from '../../src/domain/shift';
import { DepotNotFoundError } from '../../src/domain/errors';
import { DepotService } from '../../src/application/services/depot.service';
import { OwnershipType } from '../../src/domain/inventory';
import { InMemoryDepotRepository, InMemoryRosterRepository } from '../support/fakes';

const WEEK = '2026-07-14';
const STAFF = '33333333-3333-3333-3333-333333333333';
const OTHER_DEPOT = '44444444-4444-4444-4444-444444444444';

/** B1: the roster is depot-scoped, so every call now carries who is asking. */
const kepalaDepot = (depotId: string) =>
  ({ sub: 'kd-1', role: 'KEPALA_DEPOT', phone: '0811', depotId }) as never;
const headOffice = () => ({ sub: 'hq-1', role: 'SUPER_ADMIN', phone: '0822' }) as never;

describe('RosterService', () => {
  let repo: InMemoryRosterRepository;
  let service: RosterService;
  let depotId: string;
  const hq = headOffice();

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
    await service.setCell(hq, depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.MORNING);
    await service.setCell(hq, depotId, WEEK, STAFF, 'Budi', 1, ShiftKind.EVENING);
    await service.setCell(hq, depotId, '2026-07-21', STAFF, 'Budi', 0, ShiftKind.OFF);

    const week = await service.week(hq, depotId, WEEK);
    expect(week).toHaveLength(2);
    expect(week.map((c) => c.day).sort()).toEqual([0, 1]);
  });

  it('upserts a cell in place instead of duplicating (depot+week+staff+day is unique)', async () => {
    const first = await service.setCell(hq, depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.MORNING);
    const second = await service.setCell(hq, depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.EVENING);

    expect(second.id).toBe(first.id);
    expect(second.shift).toBe(ShiftKind.EVENING);
    const week = await service.week(hq, depotId, WEEK);
    expect(week).toHaveLength(1);
  });

  it('bulk-sets many cells at once', async () => {
    const rows = await service.bulkSet(hq, depotId, WEEK, [
      { staffId: STAFF, staffName: 'Budi', day: 0, shift: ShiftKind.MORNING },
      { staffId: STAFF, staffName: 'Budi', day: 2, shift: ShiftKind.OFF },
    ]);
    expect(rows).toHaveLength(2);
    expect(await service.week(hq, depotId, WEEK)).toHaveLength(2);
  });

  it('rejects an unknown depot', async () => {
    await expect(
      service.week(hq, '00000000-0000-0000-0000-000000000000', WEEK),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  /*
   * B1. `driverRoster` is held by KEPALA_DEPOT and MANAGER, both bound to one depot, and
   * `depotId` arrives in the query and the body. With no check, a depot head could read
   * another depot's roster — names and staff ids — overwrite its cells, and change other
   * people's days off, 200 cells at a time through the bulk route.
   */
  describe('depot scope', () => {
    it("refuses to read another depot's week", async () => {
      await expect(service.week(kepalaDepot(OTHER_DEPOT), depotId, WEEK)).rejects.toThrow();
    });

    it("refuses to overwrite a cell in another depot's week", async () => {
      await expect(
        service.setCell(kepalaDepot(OTHER_DEPOT), depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.OFF),
      ).rejects.toThrow();
      expect(await service.week(hq, depotId, WEEK)).toHaveLength(0);
    });

    it("refuses a bulk write into another depot's week — all 200 cells, not some", async () => {
      await expect(
        service.bulkSet(kepalaDepot(OTHER_DEPOT), depotId, WEEK, [
          { staffId: STAFF, staffName: 'Budi', day: 0, shift: ShiftKind.MORNING },
          { staffId: STAFF, staffName: 'Budi', day: 1, shift: ShiftKind.OFF },
        ]),
      ).rejects.toThrow();
      expect(await service.week(hq, depotId, WEEK)).toHaveLength(0);
    });

    // The other half: their own depot still works, and so does HQ's network-wide view.
    it('lets a depot head manage their own week', async () => {
      const own = kepalaDepot(depotId);
      await service.setCell(own, depotId, WEEK, STAFF, 'Budi', 0, ShiftKind.OFF);
      const week = await service.week(own, depotId, WEEK);
      expect(week).toHaveLength(1);
      expect(week[0]?.shift).toBe(ShiftKind.OFF);
    });

    // Refused BEFORE the existence check, so a 403 cannot be used to probe which depot ids
    // are real.
    it('refuses another depot before it says whether that depot exists', async () => {
      await expect(
        service.week(kepalaDepot(depotId), OTHER_DEPOT, WEEK),
      ).rejects.not.toBeInstanceOf(DepotNotFoundError);
    });
  });
});
