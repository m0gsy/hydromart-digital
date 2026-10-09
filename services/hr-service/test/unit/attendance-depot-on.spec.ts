import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee } from '../../prisma/generated/client';
import { AttendanceService, FacePunch } from '../../src/application/services/attendance.service';
import { HrConfigService } from '../../src/config/hr-config.service';
import type { DepotMove } from '../../src/domain/depot-on';

const G = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const DAY = (k: string) => new Date(`${k}T00:00:00.000Z`);

const punchAt = (lat: number, lng: number): FacePunch => ({ image: Buffer.from('x'), photoUrl: null, lat, lng });
// Galaksi fence at (-6.20, 106.80); Pekayon fence at (-6.30, 106.90); 150 m each.
const FENCES: Record<string, { lat: number; lng: number; radiusM: number }> = {
  [G]: { lat: -6.2, lng: 106.8, radiusM: 150 },
  [P]: { lat: -6.3, lng: 106.9, radiusM: 150 },
};
const atG = punchAt(-6.2, 106.8);
const atP = punchAt(-6.3, 106.9);

const self: AuthenticatedUser = { sub: 'acct-1', role: 'STAFF_DEPOT' as never, phone: '08', depotId: G };

const START_16: DepotMove = {
  kind: 'LOAN_START',
  effectiveDate: '2026-10-16',
  seq: 1,
  fromDepotId: G,
  toDepotId: P,
  loanEndDate: '2026-10-25',
};

function employee(over: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    fullName: 'Budi',
    status: 'ACTIVE',
    authSubjectId: 'acct-1',
    depotId: G,
    homeDepotId: G,
    shiftId: null,
    ...over,
  } as Employee;
}

interface Opts {
  enabled?: boolean;
  emp?: Employee;
  moves?: DepotMove[];
  rows?: Attendance[];
  shifts?: Record<string, { depotId: string | null; startTime: string }>;
  activeShift?: Record<string, { startTime: string }>;
  assigned?: string | null;
}

function make(opts: Opts = {}) {
  const emp = opts.emp ?? employee();
  const created: Record<string, unknown>[] = [];
  const patched: Record<string, unknown>[] = [];
  const timelineFor = jest.fn(async () => opts.moves ?? []);
  const rows = opts.rows ?? [];
  const att = {
    findByEmployeeAndDate: jest.fn(async (_e: string, d: Date) =>
      rows.find((r) => r.workDate.getTime() === d.getTime()) ?? null,
    ),
    findById: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    create: jest.fn(async (i: Record<string, unknown>) => {
      created.push(i);
      return { id: 'new', ...i } as unknown as Attendance;
    }),
    patchCheckOut: jest.fn(async (id: string, p: Record<string, unknown>) => {
      patched.push({ id, ...p });
      return { ...rows.find((r) => r.id === id)!, ...p } as Attendance;
    }),
    patchStatus: jest.fn(),
    upsertManual: jest.fn(async (i: Record<string, unknown>) => ({ id: 'm1', ...i }) as unknown as Attendance),
    recordAdjustment: jest.fn(),
    listAdjustments: jest.fn(async () => []),
    list: jest.fn(async (f: { from?: Date; to?: Date }) => ({
      rows: rows.filter((r) => (!f.from || r.workDate >= f.from) && (!f.to || r.workDate <= f.to)),
      total: rows.length,
    })),
  };
  const cfg = {
    timeZone: 'Asia/Jakarta',
    depotAssignmentEnabled: opts.enabled ?? true,
    workStartTime: () => '08:00',
    // Pekayon is strict (no grace); everyone else gets fifteen minutes.
    lateToleranceMinutes: (d: string | null) => (d === P ? 0 : 15),
    geofence: (d: string | null) => (d && FENCES[d]) || { lat: null, lng: null, radiusM: 0 },
    offlineAutoAcceptMinutes: () => 10,
    offlineMaxAgeHours: () => 24,
  } as unknown as HrConfigService;
  const shifts = {
    listAssignmentsUpTo: jest.fn(async () =>
      opts.assigned ? [{ shiftId: opts.assigned, effectiveFrom: DAY('2026-01-01'), rotationId: null }] : [],
    ),
    findRotationById: jest.fn(async () => null),
    findById: jest.fn(async (id: string) => (opts.shifts?.[id] ? { id, ...opts.shifts[id] } : null)),
    findActiveForDepot: jest.fn(async (d: string | null) => (d && opts.activeShift?.[d]) || null),
  };
  const svc = new AttendanceService(
    att as never,
    { verify: async () => ({ matched: true, score: 0.9 }) } as never,
    { listActiveByEmployee: async () => [{ vector: [1] }] } as never,
    { findById: async () => emp, findByAuthSubjectId: async () => emp } as never,
    cfg,
    undefined,
    shifts as never,
    { timelineFor } as never,
  );
  return { svc, att, created, patched, timelineFor, shifts };
}

// 2026-10-16 00:10 Jakarta = 2026-10-15T17:10Z: the first minutes of the loan's first day.
const FIRST_MINUTES = new Date('2026-10-15T17:10:00.000Z');
// 2026-10-16 08:05 Jakarta
const MORNING_16 = new Date('2026-10-16T01:05:00.000Z');

describe('check-in uses the depot worked at on the punch day', () => {
  it('flag off: the ledger is never read and the stamp is the live depot (identical to before)', async () => {
    const t = make({ enabled: false, moves: [START_16] });
    await t.svc.checkIn(self, atG, MORNING_16);
    expect(t.timelineFor).not.toHaveBeenCalled();
    expect(t.created[0].depotId).toBe(G);
  });

  it('no moves at all: the live depot, no matter the flag', async () => {
    const t = make({ moves: [] });
    await t.svc.checkIn(self, atG, MORNING_16);
    expect(t.created[0].depotId).toBe(G);
  });

  it('the sweep has not run yet (live depot still home) but the ledger says the loan began: stamped and fenced at the destination', async () => {
    const t = make({ moves: [START_16], emp: employee({ depotId: G }) });
    await expect(t.svc.checkIn(self, atG, MORNING_16)).rejects.toBeInstanceOf(ForbiddenException);
    await t.svc.checkIn(self, atP, MORNING_16);
    expect(t.created[0].depotId).toBe(P);
  });

  it('the loan is over but the sweep is late (live depot still destination): the day belongs to home', async () => {
    const t = make({ moves: [START_16], emp: employee({ depotId: P }) });
    const MORNING_26 = new Date('2026-10-26T01:05:00.000Z');
    await t.svc.checkIn(self, atG, MORNING_26);
    expect(t.created[0].depotId).toBe(G);
  });

  it('a punch queued offline is judged by the day it was TAKEN, not the day it synced', async () => {
    const t = make({ moves: [START_16] });
    // Taken 2026-10-15 23:50 Jakarta (still home), synced 2026-10-16 08:05 (already on loan).
    const taken = new Date('2026-10-15T16:50:00.000Z');
    await t.svc.checkIn(self, { ...atG, capturedAt: taken }, MORNING_16);
    expect(t.created[0].depotId).toBe(G);
  });

  it('late tolerance and shift start follow the work depot, and a home-depot shift assignment is ignored while lent', async () => {
    const t = make({
      moves: [START_16],
      assigned: 'home-shift',
      shifts: { 'home-shift': { depotId: G, startTime: '06:00' } },
      activeShift: { [P]: { startTime: '09:00' } },
    });
    // 08:05 is late against the home shift (06:00) but on time against Pekayon's 09:00.
    await t.svc.checkIn(self, atP, MORNING_16);
    expect(t.created[0]).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
  });

  it('the lateness grace is the work depot, so 08:05 at strict Pekayon is late with no shift at all', async () => {
    const t = make({ moves: [START_16] });
    await t.svc.checkIn(self, atP, MORNING_16);
    expect(t.created[0]).toMatchObject({ status: 'LATE', lateMinutes: 5 });
  });

  it('with an empty ledger the live depot wins even if the home column disagrees', async () => {
    const t = make({ moves: [], emp: employee({ depotId: G, homeDepotId: P }) });
    await t.svc.checkIn(self, atG, MORNING_16);
    expect(t.created[0].depotId).toBe(G);
  });

  it('not lent: an assigned shift from another depot still counts exactly as before', async () => {
    const t = make({
      moves: [],
      assigned: 'other',
      shifts: { other: { depotId: P, startTime: '06:00' } },
    });
    await t.svc.checkIn(self, atG, MORNING_16);
    expect(t.created[0]).toMatchObject({ status: 'LATE' });
  });

  it('refuses to guess when the punch is too old (offline max age) even before geofence', async () => {
    const t = make({ moves: [START_16] });
    const ancient = new Date('2026-10-10T01:00:00.000Z');
    await expect(
      t.svc.checkIn(self, { ...atG, capturedAt: ancient }, MORNING_16),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('first minutes of the first day: a punch at 00:10 WIB is already the destination', async () => {
    const t = make({ moves: [START_16] });
    await t.svc.checkIn(self, atP, FIRST_MINUTES);
    expect(t.created[0].depotId).toBe(P);
  });
});

describe('check-out across midnight', () => {
  const nightRow = {
    id: 'night',
    employeeId: 'emp-1',
    depotId: G,
    workDate: DAY('2026-10-24'),
    checkInAt: new Date('2026-10-24T15:00:00.000Z'), // 22:00 Jakarta
    checkOutAt: null,
    status: 'PRESENT',
  } as unknown as Attendance;

  it('closes the open row from the evening before instead of "Belum check-in hari ini"', async () => {
    const t = make({ rows: [nightRow] });
    // 06:00 Jakarta on the 25th = 23:00Z on the 24th.
    await t.svc.checkOut(self, atG, new Date('2026-10-24T23:00:00.000Z'));
    expect(t.patched[0]).toMatchObject({ id: 'night', workingMinutes: 480 });
  });

  it('is fenced by the depot the row was stamped with, not today', async () => {
    const t = make({ rows: [{ ...nightRow, depotId: P } as Attendance] });
    await expect(t.svc.checkOut(self, atG, new Date('2026-10-24T23:00:00.000Z'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await t.svc.checkOut(self, atP, new Date('2026-10-24T23:00:00.000Z'));
    expect(t.patched).toHaveLength(1);
  });

  it('does not reach back further than 24 hours, or onto a row already closed', async () => {
    const old = { ...nightRow, checkInAt: new Date('2026-10-22T15:00:00.000Z'), workDate: DAY('2026-10-22') } as Attendance;
    await expect(
      make({ rows: [old] }).svc.checkOut(self, atG, new Date('2026-10-24T23:00:00.000Z')),
    ).rejects.toThrow(/Belum check-in/);
    const closed = { ...nightRow, checkOutAt: new Date('2026-10-24T20:00:00.000Z') } as Attendance;
    await expect(
      make({ rows: [closed] }).svc.checkOut(self, atG, new Date('2026-10-24T23:00:00.000Z')),
    ).rejects.toThrow(/Belum check-in/);
  });

  it('a row opened 25 hours ago is too old to close, even though it is in the look-back window', async () => {
    const stale = {
      ...nightRow,
      workDate: DAY('2026-10-24'),
      checkInAt: new Date('2026-10-23T23:00:00.000Z'), // 25h before the punch below
    } as Attendance;
    await expect(
      make({ rows: [stale] }).svc.checkOut(self, atG, new Date('2026-10-25T00:00:00.000Z')),
    ).rejects.toThrow(/Belum check-in/);
  });

  it('a same-day row still wins: the ordinary day shift is untouched', async () => {
    const today = { ...nightRow, workDate: DAY('2026-10-24'), checkInAt: new Date('2026-10-24T01:00:00.000Z') } as Attendance;
    const t = make({ rows: [today] });
    await t.svc.checkOut(self, atG, new Date('2026-10-24T09:00:00.000Z'));
    expect(t.patched[0]).toMatchObject({ id: 'night', workingMinutes: 480 });
  });
});

describe('who may correct a day', () => {
  const manager = (depotId: string): AuthenticatedUser =>
    ({ sub: 'm', role: 'MANAGER' as never, phone: null, depotId, depotIds: [depotId] }) as AuthenticatedUser;
  const stamped = (depotId: string) =>
    ({ id: 'r1', employeeId: 'emp-1', depotId, workDate: DAY('2026-10-20'), status: 'PRESENT' }) as unknown as Attendance;

  it('flag on: the manager of the depot the day was worked at may adjust it, the live-depot manager may not', async () => {
    const lentEnded = make({ rows: [stamped(P)] }); // live depot is G now
    await expect(lentEnded.svc.adjust(manager(P), 'r1', { reason: 'x', status: 'LATE' as never })).resolves.toBeDefined();
    await expect(lentEnded.svc.adjust(manager(G), 'r1', { reason: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(lentEnded.svc.listAdjustments(manager(G), 'r1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(lentEnded.svc.listAdjustments(manager(P), 'r1')).resolves.toEqual([]);
  });

  it('flag off: access is by the live depot exactly as before', async () => {
    const t = make({ enabled: false, rows: [stamped(P)] });
    await expect(t.svc.adjust(manager(G), 'r1', { reason: 'x' })).resolves.toBeDefined();
    await expect(t.svc.adjust(manager(P), 'r1', { reason: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a row with no stamp falls back to the live depot', async () => {
    const t = make({ rows: [{ ...stamped(G), depotId: null } as unknown as Attendance] });
    await expect(t.svc.adjust(manager(G), 'r1', { reason: 'x' })).resolves.toBeDefined();
  });

  it('manual entry for a past day is stamped and gated by the depot of THAT day', async () => {
    const t = make({ moves: [START_16] });
    await expect(
      t.svc.createManual(manager(G), { employeeId: 'emp-1', workDate: '2026-10-20', status: 'ABSENT' as never, reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await t.svc.createManual(manager(P), { employeeId: 'emp-1', workDate: '2026-10-20', status: 'ABSENT' as never, reason: 'x' });
    expect(t.att.upsertManual.mock.calls[0][0]).toMatchObject({ depotId: P });
  });
});
