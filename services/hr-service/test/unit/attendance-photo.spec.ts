import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee } from '../../prisma/generated/client';
import { AttendanceService } from '../../src/application/services/attendance.service';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { StoragePort } from '../../src/application/ports/storage.port';
import { HrConfigService } from '../../src/config/hr-config.service';

/**
 * CA-1-66 — the face check-in nobody could look at.
 *
 * Every face punch stores a frame and a match score, and neither ever reached a screen. HR
 * approving a pending punch, or correcting a day, decided on evidence it was not shown.
 *
 * The bytes leave through the service for the same reason a document's do (SEC-01) — behind
 * the capability and the employee's depot check — and the object key is DERIVED from the
 * stored URL rather than fetched from it. A row whose URL points anywhere but this
 * deployment's own bucket answers "no photo", instead of making the server issue a request
 * to whatever the column happens to say.
 */

const BASE = 'https://cdn.example.com';

const hq: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };
const otherDepot: AuthenticatedUser = {
  sub: 'mgr',
  role: 'MANAGER' as never,
  phone: null,
  depotId: 'd-other',
};

const employee = { id: 'e1', depotId: 'd1' } as Employee;

function attendance(over: Partial<Attendance> = {}): Attendance {
  return {
    id: 'a1',
    employeeId: 'e1',
    depotId: 'd1',
    workDate: new Date('2026-07-01T00:00:00Z'),
    status: 'PRESENT',
    lateMinutes: 0,
    checkInAt: new Date('2026-07-01T01:00:00Z'),
    checkOutAt: null,
    checkInPhotoUrl: `${BASE}/hr/attendance/abc.jpg`,
    checkOutPhotoUrl: null,
    checkInScore: 0.81,
    checkOutScore: null,
    ...over,
  } as Attendance;
}

function build(row: Attendance, storagePublicBaseUrl = BASE) {
  const asked: string[] = [];
  const repo = {
    findById: async (id: string) => (id === row.id ? row : null),
  } as unknown as AttendanceRepository;
  const employees = { findById: async () => employee } as unknown as EmployeeRepository;
  const storage = {
    getObject: async (key: string) => {
      asked.push(key);
      return { body: Buffer.from('jpegbytes'), contentType: 'image/jpeg' };
    },
  } as unknown as StoragePort;
  const config = { storagePublicBaseUrl } as HrConfigService;
  const svc = new AttendanceService(
    repo,
    {} as never,
    {} as never,
    employees,
    config,
    storage,
  );
  return { svc, asked };
}

describe('CA-1-66 the frame a punch was accepted on', () => {
  it('reads the object the stored URL points at, inside this deployment’s own bucket', async () => {
    const { svc, asked } = build(attendance());
    const out = await svc.photo(hq, 'a1', 'in');

    expect(out.body.toString()).toBe('jpegbytes');
    expect(out.contentType).toBe('image/jpeg');
    // The key, not the URL: nothing here fetches an address a row happens to carry.
    expect(asked).toEqual(['hr/attendance/abc.jpg']);
  });

  it('refuses a row from another depot before it touches storage', async () => {
    const { svc, asked } = build(attendance());
    await expect(svc.photo(otherDepot, 'a1', 'in')).rejects.toThrow();
    expect(asked).toEqual([]);
  });

  it('answers "no photo" for a manual entry that never had one', async () => {
    const { svc, asked } = build(attendance({ checkInPhotoUrl: null }));
    await expect(svc.photo(hq, 'a1', 'in')).rejects.toBeInstanceOf(NotFoundException);
    expect(asked).toEqual([]);
  });

  it.each([
    ['a URL on somebody else’s host', 'https://attacker.example/hr/attendance/x.jpg'],
    ['a path that climbs out of the prefix', `${BASE}/hr/../../etc/passwd`],
    ['an object outside the hr/ prefix', `${BASE}/private/keys.json`],
  ])('never fetches %s', async (_label, url) => {
    const { svc, asked } = build(attendance({ checkInPhotoUrl: url }));
    await expect(svc.photo(hq, 'a1', 'in')).rejects.toBeInstanceOf(NotFoundException);
    expect(asked).toEqual([]);
  });

  it('answers "no photo" when this deployment has no public base configured at all', async () => {
    const { svc, asked } = build(attendance(), '');
    await expect(svc.photo(hq, 'a1', 'in')).rejects.toBeInstanceOf(NotFoundException);
    expect(asked).toEqual([]);
  });

  it('reads the check-out frame when that is the one asked for', async () => {
    const { svc, asked } = build(
      attendance({ checkOutPhotoUrl: `${BASE}/hr/attendance/out.jpg`, checkOutScore: 0.9 }),
    );
    await svc.photo(hq, 'a1', 'out');
    expect(asked).toEqual(['hr/attendance/out.jpg']);
  });

  it('404s when the employee behind the row is gone', async () => {
    const repo = {
      findById: async () => attendance(),
    } as unknown as AttendanceRepository;
    const svc = new AttendanceService(
      repo,
      {} as never,
      {} as never,
      { findById: async () => null } as unknown as EmployeeRepository,
      { storagePublicBaseUrl: BASE } as HrConfigService,
      {} as unknown as StoragePort,
    );
    await expect(svc.photo(hq, 'a1', 'in')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when this deployment has no storage adapter wired at all', async () => {
    const repo = {
      findById: async () => attendance(),
    } as unknown as AttendanceRepository;
    const svc = new AttendanceService(
      repo,
      {} as never,
      {} as never,
      { findById: async () => employee } as unknown as EmployeeRepository,
      { storagePublicBaseUrl: BASE } as HrConfigService,
    );
    await expect(svc.photo(hq, 'a1', 'in')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('falls back to image/jpeg when the bucket does not say what the object is', async () => {
    const repo = {
      findById: async () => attendance(),
    } as unknown as AttendanceRepository;
    const storage = {
      getObject: async () => ({ body: Buffer.from('x'), contentType: null }),
    } as unknown as StoragePort;
    const svc = new AttendanceService(
      repo,
      {} as never,
      {} as never,
      { findById: async () => employee } as unknown as EmployeeRepository,
      { storagePublicBaseUrl: BASE } as HrConfigService,
      storage,
    );
    await expect(svc.photo(hq, 'a1', 'in')).resolves.toMatchObject({
      contentType: 'image/jpeg',
    });
  });

  it('404s an attendance row that does not exist', async () => {
    const { svc } = build(attendance());
    await expect(svc.photo(hq, 'a2', 'in')).rejects.toBeInstanceOf(NotFoundException);
  });
});
