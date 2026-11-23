import { ForbiddenException, Logger } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee } from '../../prisma/generated/client';
import { AttendanceService, FacePunch } from '../../src/application/services/attendance.service';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import { DepotDirectoryPort } from '../../src/application/ports/depot-directory.port';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import { FaceVerifier } from '../../src/application/ports/face-verifier.port';
import { HrConfigService } from '../../src/config/hr-config.service';
import { Geofence } from '../../src/domain/geofence';

/*
 * 2026-11-21: staff standing at Galaxy and Pekayon were refused as "1777 m" away. HR's points
 * were right; the phones sent Android's approximate location, snapped to a 2 km grid. These
 * pin what replaced it: the fence centres on the depot's own coordinates unless HR placed a
 * point, an approximate fix outside is refused for what it is, and every refusal is logged.
 */
const G = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
// Galaxy's master coordinates in depot-service, and Pekayon's.
const GALAXY = { lat: -6.261605, lng: 106.937094 };
const PEKAYON = { lat: -6.27, lng: 106.98 };
// What the refused phones sent (on the coarse grid), about 3 km from Galaxy's door.
const COARSE = { lat: -6.27027027027027, lng: 106.9642098165971 };
// A precise fix about 1.1 km north of Galaxy.
const NORTH = { lat: -6.2516, lng: 106.937094 };
const AT = new Date('2026-11-23T00:55:00.000Z'); // 07:55 WIB, on time

const punchAt = (p: { lat: number; lng: number }, accuracyM?: number): FacePunch => ({
  image: Buffer.from('x'),
  photoUrl: null,
  ...p,
  accuracyM,
});
const OFF: Geofence = { lat: null, lng: null, radiusM: 0 };

function make(opts: {
  fences: Record<string, Geofence>;
  locations?: Record<string, { lat: number; lng: number }>;
  noDirectory?: boolean;
  depotId?: string | null;
  openRow?: Partial<Attendance>;
}) {
  const created: Record<string, unknown>[] = [];
  const repo = {
    findByEmployeeAndDate: jest.fn(async () => (opts.openRow ?? null) as Attendance | null),
    create: jest.fn(async (row: Record<string, unknown>) => {
      created.push(row);
      return { id: 'a1', ...row } as unknown as Attendance;
    }),
    patchCheckOut: jest.fn(async (id: string, patch: Record<string, unknown>) => {
      return { ...opts.openRow, id, ...patch } as unknown as Attendance;
    }),
    patchStatus: jest.fn(async (id: string, status: string) => ({ id, status }) as unknown as Attendance),
    listAdjustments: jest.fn(async () => []),
  } as unknown as AttendanceRepository;
  const verifier = { verify: async () => ({ score: 0.9, matched: true }) } as unknown as FaceVerifier;
  const faces = {
    listActiveByEmployee: async () => [{ vector: [1, 0] }],
  } as unknown as FaceEmbeddingRepository;
  const employee = {
    id: 'emp-1',
    status: 'ACTIVE',
    authSubjectId: 'acct-1',
    depotId: opts.depotId === undefined ? G : opts.depotId,
    homeDepotId: G,
    shiftId: null,
  } as unknown as Employee;
  const employees = { findByAuthSubjectId: async () => employee } as unknown as EmployeeRepository;
  const cfg = {
    timeZone: 'Asia/Jakarta',
    depotAssignmentEnabled: false,
    workStartTime: () => '08:00',
    lateToleranceMinutes: () => 15,
    offlineMaxAgeHours: () => 24,
    // depot override ?? GLOBAL ?? off, as the settings store resolves it.
    geofence: (d: string | null) => opts.fences[d ?? 'GLOBAL'] ?? opts.fences.GLOBAL ?? OFF,
  } as unknown as HrConfigService;
  const location = jest.fn(async (id: string) => opts.locations?.[id] ?? null);
  const directory = { location } as unknown as DepotDirectoryPort;
  const svc = new AttendanceService(
    repo,
    verifier,
    faces,
    employees,
    cfg,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.noDirectory ? undefined : directory,
  );
  return { svc, created, location };
}

const self = { sub: 'acct-1', role: 'STAFF_DEPOT', depotId: G } as unknown as AuthenticatedUser;
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ForbiddenException);

describe('the fence centre', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("is the depot's own master location when HR switched the fence on without a point", async () => {
    const t = make({ fences: { [G]: { lat: null, lng: null, radiusM: 150 } }, locations: { [G]: GALAXY } });
    await t.svc.checkIn(self, punchAt(GALAXY), AT);
    expect(t.created[0]).toMatchObject({ status: 'PRESENT', depotId: G });
    expect(t.location).toHaveBeenCalledWith(G);
    await expect(t.svc.checkIn(self, punchAt(NORTH), AT)).rejects.toThrow(/batas 150 m/);
  });

  it("is HR's point when both halves are set, and then depot-service is not asked", async () => {
    const t = make({ fences: { [G]: { ...NORTH, radiusM: 150 } }, locations: { [G]: GALAXY } });
    await t.svc.checkIn(self, punchAt(NORTH), AT);
    expect(t.created).toHaveLength(1);
    expect(t.location).not.toHaveBeenCalled();
  });

  it('half a point is no point: the master location is used, whole', async () => {
    const t = make({ fences: { [G]: { lat: NORTH.lat, lng: null, radiusM: 150 } }, locations: { [G]: GALAXY } });
    await t.svc.checkIn(self, punchAt(GALAXY), AT);
    expect(t.created).toHaveLength(1);
  });

  it('is never looked up for a fence that is off (radius 0)', async () => {
    const t = make({ fences: { [G]: { lat: null, lng: null, radiusM: 0 } }, locations: { [G]: GALAXY } });
    await t.svc.checkIn(self, punchAt(COARSE), AT);
    expect(t.created).toHaveLength(1);
    expect(t.location).not.toHaveBeenCalled();
  });

  // A lookup that fails must not lock anybody out: the GPS is kept, the gap is logged.
  it('missing (depot-service cannot say) leaves the punch unfenced, and says so', async () => {
    const t = make({ fences: { [G]: { lat: null, lng: null, radiusM: 150 } } });
    await t.svc.checkIn(self, punchAt(NORTH), AT);
    expect(t.created[0]).toMatchObject({ status: 'PRESENT', checkInLat: NORTH.lat });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`depot ${G} is on but has no centre`));
  });

  it('missing (no directory wired) leaves only HR points fencing', async () => {
    const t = make({ fences: { [G]: { lat: null, lng: null, radiusM: 150 } }, noDirectory: true });
    await t.svc.checkIn(self, punchAt(NORTH), AT);
    expect(t.created).toHaveLength(1);
  });

  it('fences the check-out at the depot the shift was stamped with', async () => {
    const t = make({
      fences: { [G]: { lat: null, lng: null, radiusM: 150 } },
      locations: { [G]: GALAXY },
      openRow: { id: 'a1', depotId: G, checkInAt: AT, checkOutAt: null, status: 'PRESENT' },
    });
    const later = new Date(AT.getTime() + 8 * 3_600_000);
    await expect(t.svc.checkOut(self, punchAt(NORTH), later)).rejects.toThrow(ForbiddenException);
    await expect(t.svc.checkOut(self, punchAt(GALAXY), later)).resolves.toMatchObject({ status: 'PRESENT' });
  });
});

describe('a punch outside the fence', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  const fenced = () => make({ fences: { [G]: { lat: null, lng: null, radiusM: 150 } }, locations: { [G]: GALAXY } });

  it('on the approximate grid is refused as "Perkiraan", not as a distance', async () => {
    const err = await refusal(fenced().svc.checkIn(self, punchAt(COARSE), AT));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err?.message).toMatch(/^Lokasi HP masih "Perkiraan" \(bisa meleset sampai ±2 km\)/);
    expect(err?.message).toContain('nyalakan "Gunakan lokasi akurat" (Tepat)');
    expect(err?.message).not.toMatch(/m dari titik/);
  });

  it('that the phone itself rates loose is refused as "Perkiraan" too', async () => {
    const err = await refusal(fenced().svc.checkIn(self, punchAt(NORTH, 2000), AT));
    expect(err?.message).toMatch(/"Perkiraan"/);
  });

  it('with a precise fix says how far it was, and how far it may be', async () => {
    const err = await refusal(fenced().svc.checkIn(self, punchAt(NORTH, 12), AT));
    expect(err?.message).toMatch(/^Di luar area absen depot \(\d+ m dari titik, batas 150 m\)\. Absen harus di lokasi\./);
    expect(err?.message).toContain('pilih "Tepat" (bukan "Perkiraan")');
  });

  it('is logged once with what HR will be asked about, never the coordinates', async () => {
    await refusal(fenced().svc.checkIn(self, punchAt(COARSE), AT));
    await refusal(fenced().svc.checkIn(self, punchAt(NORTH, 12), AT));
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      new RegExp(`employee emp-1, depot ${G}, \\d+ m, radius 150 m, accuracy \\? m, approximate true`),
    );
    expect(lines[1]).toMatch(/accuracy 12 m, approximate false/);
    for (const line of lines) expect(line).not.toMatch(/-6\.2|106\.9/);
  });

  it('approximate but INSIDE still passes', async () => {
    const t = make({ fences: { [G]: { lat: null, lng: null, radiusM: 5000 } }, locations: { [G]: GALAXY } });
    await t.svc.checkIn(self, punchAt(COARSE, 2000), AT);
    expect(t.created).toHaveLength(1);
  });
});

// Above a depot nobody is refused: outside every fence is held for HR, approximate or not.
describe('a supervisor with no home depot', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());
  const spv = (depotIds: string[]) =>
    ({ sub: 'acct-1', role: 'SUPERVISOR', depotId: null, depotIds }) as unknown as AuthenticatedUser;
  // The configuration this fix makes sensible: one network radius, every depot on its own spot.
  const network = (locations: Record<string, { lat: number; lng: number }>) =>
    make({ fences: { GLOBAL: { lat: null, lng: null, radiusM: 150 } }, locations, depotId: null });

  it('is on site at any supervised depot, each fenced on its own master location', async () => {
    const t = network({ [G]: GALAXY, [P]: PEKAYON });
    await t.svc.checkIn(spv([G, P]), punchAt(PEKAYON), AT);
    expect(t.created[0]).toMatchObject({ status: 'PRESENT' });
    expect(t.location.mock.calls.map((c) => c[0]).sort()).toEqual([G, P]);
  });

  it('outside all of them, even approximately, is held PENDING rather than refused', async () => {
    const t = network({ [G]: GALAXY, [P]: PEKAYON });
    await t.svc.checkIn(spv([G, P]), punchAt(COARSE), AT);
    expect(t.created[0]).toMatchObject({ status: 'PENDING' });
  });

  // A GLOBAL point can no longer be written (depotOnly), but one stored before still resolves,
  // exactly as it did: the standing global-fence rule for a supervisor with nothing in scope.
  it('with nothing in scope, a network point stored before is still the fence, logged without a depot', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = make({ fences: { GLOBAL: { ...GALAXY, radiusM: 150 } }, depotId: null });
    await expect(t.svc.checkIn(spv([]), punchAt(NORTH, 12), AT)).rejects.toThrow(/batas 150 m/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('employee emp-1, depot -, '));
    expect(t.location).not.toHaveBeenCalled();
  });

  it('with no depot that can be located (or none at all), records the punch: the network has no spot', async () => {
    const t = network({});
    await t.svc.checkIn(spv([G]), punchAt(COARSE), AT);
    await t.svc.checkIn(spv([]), punchAt(COARSE), AT);
    expect(t.created.map((r) => r.status)).toEqual(['PRESENT', 'PRESENT']);
    expect(t.location).toHaveBeenCalledTimes(1);
  });
});
