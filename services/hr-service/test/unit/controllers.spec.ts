import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';
import type { Response } from 'express';

// Mock the xlsx helper so the reports xlsx branch doesn't need the exceljs runtime dep.
jest.mock('../../src/domain/xlsx', () => ({
  toXlsx: jest.fn(async () => Buffer.from('xlsx-bytes')),
}));

import { BonusController, DeductionController } from '../../src/modules/adjustment.controller';
import { AttendanceController } from '../../src/modules/attendance.controller';
import { AuditController } from '../../src/modules/audit.controller';
import {
  HolidayController,
  ShiftController,
  ShiftRotationController,
} from '../../src/modules/calendar.controller';
import { DepartmentController } from '../../src/modules/department.controller';
import { AllowanceController } from '../../src/modules/allowance.controller';
import { LeaveController, SelfLeaveController } from '../../src/modules/leave.controller';
import { DocumentController } from '../../src/modules/document.controller';
import { AssetController } from '../../src/modules/asset.controller';
import {
  AnnouncementController,
  SelfAnnouncementController,
} from '../../src/modules/announcement.controller';
import { decodeBase64Image } from '../../src/modules/decode-image';
import { EmployeesController } from '../../src/modules/employees.controller';
import { FaceController, SelfFaceController } from '../../src/modules/face.controller';
import { HealthController } from '../../src/modules/health.controller';
import { PayrollController } from '../../src/modules/payroll.controller';
import { PerformanceController } from '../../src/modules/performance.controller';
import { ReportsController } from '../../src/modules/reports.controller';
import { BonusRuleController, LoanController } from '../../src/modules/rules.controller';
import { SettingsController } from '../../src/modules/settings.controller';
import { toXlsx } from '../../src/domain/xlsx';

const user: AuthenticatedUser = { sub: 'u1', role: 'HR' as never, phone: null, depotId: null };
const superAdmin: AuthenticatedUser = {
  sub: 'sa',
  role: 'SUPER_ADMIN' as never,
  phone: null,
  depotId: null,
};

// A tiny data-URL PNG header (1x1) is not needed; any base64 with bytes works.
const b64 = Buffer.from('abc').toString('base64');
const dataUrl = `data:image/png;base64,${b64}`;

function fakeRes(): Response & { headers: Record<string, string>; body: unknown } {
  const res = {
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader: jest.fn(function (this: unknown, k: string, v: string) {
      (res.headers as Record<string, string>)[k] = v;
    }),
    send: jest.fn(function (this: unknown, b: unknown) {
      res.body = b;
    }),
  };
  return res as unknown as Response & { headers: Record<string, string>; body: unknown };
}

/** Build a service mock whose named methods each resolve to a distinct sentinel. */
function svcMock(methods: string[]): Record<string, jest.Mock> {
  const m: Record<string, jest.Mock> = {};
  for (const name of methods) m[name] = jest.fn().mockReturnValue(`${name}-result`);
  return m;
}

describe('decodeBase64Image', () => {
  it('decodes a plain base64 string', () => {
    expect(decodeBase64Image(b64).toString()).toBe('abc');
  });
  it('strips a data-URL prefix before decoding', () => {
    expect(decodeBase64Image(dataUrl).toString()).toBe('abc');
  });
  it('rejects input that decodes to zero bytes', () => {
    expect(() => decodeBase64Image('')).toThrow(BadRequestException);
  });
});

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const c = new HealthController(prisma as never);
    const out = await c.check();
    expect(out.status).toBe('ok');
    expect(out.service).toBe('hr-service');
    expect(out.checks.database).toBe('up');
  });
  it('throws 503 when the database query fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    const c = new HealthController(prisma as never);
    await expect(c.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('BonusController / DeductionController', () => {
  const adj = svcMock([
    'listBonuses',
    'addBonus',
    'listDeductions',
    'addDeduction',
    'importDeductions',
  ]);
  const bonus = new BonusController(adj as never);
  const ded = new DeductionController(adj as never);

  it('lists bonuses by employee + period', () => {
    expect(bonus.list({ employeeId: 'e1', periodMonth: '2026-07' } as never, user)).toBe(
      'listBonuses-result',
    );
    expect(adj.listBonuses).toHaveBeenCalledWith(user, 'e1', '2026-07');
  });
  it('adds a bonus', () => {
    const dto = { employeeId: 'e1' } as never;
    expect(bonus.create(dto, user)).toBe('addBonus-result');
    expect(adj.addBonus).toHaveBeenCalledWith(user, dto);
  });
  it('lists deductions by employee + period', () => {
    expect(ded.list({ employeeId: 'e2', periodMonth: '2026-08' } as never, user)).toBe(
      'listDeductions-result',
    );
    expect(adj.listDeductions).toHaveBeenCalledWith(user, 'e2', '2026-08');
  });
  it('adds a deduction', () => {
    const dto = { employeeId: 'e2' } as never;
    expect(ded.create(dto, user)).toBe('addDeduction-result');
    expect(adj.addDeduction).toHaveBeenCalledWith(user, dto);
  });
  it('bulk-imports deductions by staff code', () => {
    const rows = [{ employeeCode: 'HR-0001', type: 'MANUAL', amount: 1 }] as never;
    expect(ded.import({ rows } as never, user)).toBe('importDeductions-result');
    expect(adj.importDeductions).toHaveBeenCalledWith(user, rows);
  });
});

describe('AttendanceController', () => {
  const att = svcMock([
    'checkIn',
    'checkOut',
    'listSelf',
    'list',
    'createManual',
    'adjust',
    'decide',
  ]);
  const c = new AttendanceController(att as never);

  it('check-in decodes the frame and forwards a punch', () => {
    const dto = { image: b64, lat: 1, lng: 2 } as never;
    c.checkIn(dto, user);
    const punch = att.checkIn.mock.calls[0][1];
    expect(att.checkIn.mock.calls[0][0]).toBe(user);
    expect(Buffer.isBuffer(punch.image)).toBe(true);
    expect(punch).toMatchObject({ photoUrl: null, lat: 1, lng: 2 });
  });
  it('check-out passes through optional fields', () => {
    const dto = { image: dataUrl, photoUrl: 'p', live: true, lat: 3, lng: 4 } as never; // `live` is accepted and ignored (B-7)
    c.checkOut(dto, user);
    const punch = att.checkOut.mock.calls[0][1];
    expect(punch).toMatchObject({ photoUrl: 'p', lat: 3, lng: 4 });
    expect(punch).not.toHaveProperty('live');
  });
  it('listSelf / list / createManual / adjust delegate', () => {
    const q = { page: 1, pageSize: 30 } as never;
    expect(c.listSelf(q, user)).toBe('listSelf-result');
    expect(att.listSelf).toHaveBeenCalledWith(user, q);
    expect(c.list(q, user)).toBe('list-result');
    expect(att.list).toHaveBeenCalledWith(user, q);
    const md = { employeeId: 'e1' } as never;
    expect(c.createManual(md, user)).toBe('createManual-result');
    expect(att.createManual).toHaveBeenCalledWith(user, md);
    const ad = { reason: 'fix' } as never;
    expect(c.adjust('id1', ad, user)).toBe('adjust-result');
    expect(att.adjust).toHaveBeenCalledWith(user, 'id1', ad);
  });
  it('check-in forwards a device capture time when the punch came from the offline queue', () => {
    const dto = { image: b64, lat: 1, lng: 2, capturedAt: '2026-07-24T01:10:00.000Z' } as never;
    c.checkIn(dto, user);
    const punch = att.checkIn.mock.calls.at(-1)?.[1];
    expect(punch.capturedAt).toEqual(new Date('2026-07-24T01:10:00.000Z'));
  });
  it('decide delegates the HR verdict', () => {
    const dto = { decision: 'APPROVE', note: 'ok' } as never;
    expect(c.decide('id1', dto, user)).toBe('decide-result');
    expect(att.decide).toHaveBeenCalledWith(user, 'id1', 'APPROVE', 'ok');
  });
});

describe('AuditController', () => {
  it('wraps the service result with pagination echo', async () => {
    const audit = { list: jest.fn().mockResolvedValue({ rows: [{ id: 'a' }], total: 5 }) };
    const c = new AuditController(audit as never);
    const q = { page: 2, pageSize: 50 } as never;
    const out = await c.list(q);
    expect(audit.list).toHaveBeenCalledWith(q);
    expect(out).toEqual({ rows: [{ id: 'a' }], total: 5, page: 2, pageSize: 50 });
  });
});

describe('HolidayController / ShiftController', () => {
  const holidays = svcMock(['list', 'create', 'remove']);
  const shifts = svcMock(['list', 'create', 'update', 'remove']);
  const hc = new HolidayController(holidays as never);
  const sc = new ShiftController(shifts as never);

  it('holidays delegate', () => {
    const q = { depotId: 'd1' } as never;
    expect(hc.list(q, user)).toBe('list-result');
    expect(holidays.list).toHaveBeenCalledWith(user, q);
    const dto = { date: '2026-01-01' } as never;
    hc.create(dto, user);
    expect(holidays.create).toHaveBeenCalledWith(user, dto);
    hc.remove('h1', user);
    expect(holidays.remove).toHaveBeenCalledWith(user, 'h1');
  });
  it('departments delegate (list passes depotId)', () => {
    const departments = svcMock(['list', 'create', 'update', 'remove']);
    const dc = new DepartmentController(departments as never);
    dc.list({ depotId: 'd2' } as never, user);
    expect(departments.list).toHaveBeenCalledWith(user, 'd2');
    const dto = { code: 'FIN', name: 'Keuangan' } as never;
    dc.create(dto, user);
    expect(departments.create).toHaveBeenCalledWith(user, dto);
    const ud = { name: 'Finance' } as never;
    dc.update('dep1', ud, user);
    expect(departments.update).toHaveBeenCalledWith(user, 'dep1', ud);
    dc.remove('dep1', user);
    expect(departments.remove).toHaveBeenCalledWith(user, 'dep1');
  });
  it('allowances delegate', () => {
    const allowances = svcMock(['list', 'add', 'deactivate', 'importMany']);
    const ac = new AllowanceController(allowances as never);
    ac.list({ employeeId: 'e1' } as never, user);
    expect(allowances.list).toHaveBeenCalledWith(user, 'e1');
    const dto = { employeeId: 'e1', type: 'TRANSPORT', amount: 1 } as never;
    ac.create(dto, user);
    expect(allowances.add).toHaveBeenCalledWith(user, dto);
    ac.deactivate('a1', user);
    expect(allowances.deactivate).toHaveBeenCalledWith(user, 'a1');
    const rows = [{ employeeCode: 'HR-0001', type: 'TRANSPORT', amount: 1 }] as never;
    ac.import({ rows } as never, user);
    expect(allowances.importMany).toHaveBeenCalledWith(user, rows);
  });
  it('leave controllers delegate, self and approval sides apart', () => {
    const leave = svcMock([
      'listSelf',
      'myBalance',
      'submit',
      'cancel',
      'listForApproval',
      'decideManager',
      'decideHr',
      'importBalances',
    ]);
    const self = new SelfLeaveController(leave as never);
    const queue = new LeaveController(leave as never);

    self.list({ page: 2, pageSize: 5 } as never, user);
    expect(leave.listSelf).toHaveBeenCalledWith(user, 2, 5);
    self.balance({ year: 2026 } as never, user);
    expect(leave.myBalance).toHaveBeenCalledWith(user, 2026);
    const dto = { type: 'ANNUAL' } as never;
    self.submit(dto, user);
    expect(leave.submit).toHaveBeenCalledWith(user, dto);
    self.cancel('lv1', user);
    expect(leave.cancel).toHaveBeenCalledWith(user, 'lv1');

    const q = { status: 'PENDING_HR' } as never;
    queue.list(q, user);
    expect(leave.listForApproval).toHaveBeenCalledWith(user, q);
    queue.manager('lv1', { approve: true } as never, user);
    expect(leave.decideManager).toHaveBeenCalledWith(user, 'lv1', true, undefined);
    queue.hr('lv1', { approve: false, note: 'kurang bukti' } as never, user);
    expect(leave.decideHr).toHaveBeenCalledWith(user, 'lv1', false, 'kurang bukti');

    const rows = [{ employeeCode: 'HR-0001', year: 2026, quotaDays: 12 }] as never;
    queue.importBalances({ rows } as never, user);
    expect(leave.importBalances).toHaveBeenCalledWith(user, rows);
  });
  it('documents delegate, including the internal retention purge', () => {
    const documents = svcMock(['list', 'get', 'upload', 'purgeRetentionEligible']);
    const dc = new DocumentController(documents as never);
    dc.list({ employeeId: 'e1' } as never, user);
    expect(documents.list).toHaveBeenCalledWith(user, 'e1');
    dc.get('doc1', user);
    expect(documents.get).toHaveBeenCalledWith(user, 'doc1');
    const dto = { employeeId: 'e1', type: 'KTP' } as never;
    const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 1 };
    dc.upload(dto, user, file);
    expect(documents.upload).toHaveBeenCalledWith(user, dto, file);
    dc.purge({ cutoff: '2026-01-01T00:00:00.000Z' } as never);
    expect(documents.purgeRetentionEligible).toHaveBeenCalledWith(
      new Date('2026-01-01T00:00:00.000Z'),
    );
  });
  it('assets delegate, movements included', () => {
    const assets = svcMock(['list', 'getById', 'create', 'update', 'move', 'importMany']);
    const ac = new AssetController(assets as never);
    const q = { depotId: 'd1', status: 'ASSIGNED' } as never;
    expect(ac.list(q, user)).toBe('list-result');
    expect(assets.list).toHaveBeenCalledWith(user, q);
    ac.getById('as1', user);
    expect(assets.getById).toHaveBeenCalledWith(user, 'as1');
    const dto = { code: 'MTR-1', type: 'MOTORCYCLE' } as never;
    ac.create(dto, user);
    expect(assets.create).toHaveBeenCalledWith(user, dto);
    const ud = { name: 'Beat' } as never;
    ac.update('as1', ud, user);
    expect(assets.update).toHaveBeenCalledWith(user, 'as1', ud);
    const mv = { kind: 'ASSIGN', toEmployeeId: 'e1' } as never;
    ac.move('as1', mv, user);
    expect(assets.move).toHaveBeenCalledWith(user, 'as1', mv);
    const rows = [{ code: 'MTR-2', type: 'MOTORCYCLE', name: 'Beat', depotId: 'd1' }] as never;
    ac.import({ rows } as never, user);
    expect(assets.importMany).toHaveBeenCalledWith(user, rows);
  });
  it('shift rotations and assignments delegate', () => {
    const svc = svcMock([
      'listRotations',
      'createRotation',
      'updateRotation',
      'listAssignments',
      'assign',
    ]);
    const rc = new ShiftRotationController(svc as never);
    rc.list({ depotId: 'd2' } as never, user);
    expect(svc.listRotations).toHaveBeenCalledWith(user, 'd2');
    const dto = { name: 'Rotasi A', pattern: { '1': 's1' } } as never;
    rc.create(dto, user);
    expect(svc.createRotation).toHaveBeenCalledWith(user, dto);
    const ud = { active: false } as never;
    rc.update('rot1', ud, user);
    expect(svc.updateRotation).toHaveBeenCalledWith(user, 'rot1', ud);
    rc.listAssignments({ employeeId: 'e1' } as never, user);
    expect(svc.listAssignments).toHaveBeenCalledWith(user, 'e1');
    const ad = { employeeId: 'e1', shiftId: 's1', effectiveFrom: '2026-08-01' } as never;
    rc.assign(ad, user);
    expect(svc.assign).toHaveBeenCalledWith(user, ad);
  });
  it('announcements delegate, self and HR sides apart', () => {
    const svc = svcMock(['list', 'getById', 'create', 'publishDue', 'listForSelf', 'markRead']);
    const hrSide = new AnnouncementController(svc as never);
    hrSide.list({ page: 2, pageSize: 5 } as never);
    expect(svc.list).toHaveBeenCalledWith(2, 5);
    hrSide.list({} as never);
    expect(svc.list).toHaveBeenLastCalledWith(undefined, undefined);
    hrSide.getById('an1');
    expect(svc.getById).toHaveBeenCalledWith('an1');
    const dto = { title: 't', body: 'b', targets: [{ dimension: 'COMPANY' }] } as never;
    hrSide.create(dto, user);
    expect(svc.create).toHaveBeenCalledWith(user, dto);
    hrSide.publishDue();
    expect(svc.publishDue).toHaveBeenCalled();

    const selfSide = new SelfAnnouncementController(svc as never);
    selfSide.list(user);
    expect(svc.listForSelf).toHaveBeenCalledWith(user);
    selfSide.markRead('an1', user);
    expect(svc.markRead).toHaveBeenCalledWith(user, 'an1');
  });
  it('shifts delegate (list passes depotId)', () => {
    sc.list({ depotId: 'd2' } as never, user);
    expect(shifts.list).toHaveBeenCalledWith(user, 'd2');
    const dto = { name: 'Pagi' } as never;
    sc.create(dto, user);
    expect(shifts.create).toHaveBeenCalledWith(user, dto);
    const ud = { name: 'Sore' } as never;
    sc.update('s1', ud, user);
    expect(shifts.update).toHaveBeenCalledWith(user, 's1', ud);
    sc.remove('s1', user);
    expect(shifts.remove).toHaveBeenCalledWith(user, 's1');
  });
});

describe('EmployeesController', () => {
  const emp = svcMock([
    'list',
    'getById',
    'getHistory',
    'create',
    'update',
    'importMany',
    'retentionReport',
    'retentionAnonymise',
    'purgeBiometrics',
    'provisionFromInvite',
    'provisionManyFromInvite',
    'setActiveInternal',
    'setDepotInternal',
    'anonymiseByAccount',
    'createAccountFor',
  ]);
  const c = new EmployeesController(emp as never);

  // The three internal PDP-retention routes: admin-service decides the cutoff, HR only
  // counts, anonymises and purges biometrics against it.
  it('passes the retention cutoff through as a Date', () => {
    const cutoff = '2020-01-01T00:00:00.000Z';
    c.retentionReport({ cutoff } as never);
    expect(emp.retentionReport).toHaveBeenCalledWith(new Date(cutoff));
    c.retentionAnonymise({ cutoff } as never);
    expect(emp.retentionAnonymise).toHaveBeenCalledWith(new Date(cutoff));
    c.purgeBiometrics({ cutoff } as never);
    expect(emp.purgeBiometrics).toHaveBeenCalledWith(new Date(cutoff));
  });

  it('delegates every route', () => {
    const q = { page: 1 } as never;
    c.list(q, user);
    expect(emp.list).toHaveBeenCalledWith(user, q);
    c.getById('e1', user);
    expect(emp.getById).toHaveBeenCalledWith(user, 'e1');
    c.getHistory('e1', user);
    expect(emp.getHistory).toHaveBeenCalledWith(user, 'e1');
    const dto = { fullName: 'Budi' } as never;
    c.create(dto, user);
    expect(emp.create).toHaveBeenCalledWith(user, dto);
    const ud = { fullName: 'Budi 2' } as never;
    c.update('e1', ud, user);
    expect(emp.update).toHaveBeenCalledWith(user, 'e1', ud);
    // The import route hands the service the rows only — the DTO wrapper stops here.
    const rows = [{ fullName: 'Budi', role: 'STAFF_DEPOT' }] as never;
    c.import({ rows } as never, user);
    expect(emp.importMany).toHaveBeenCalledWith(user, rows, 'CREATE');
  });

  // The four internal routes auth-service drives, plus the badge that mints a login.
  // Each is a pure passthrough — the point is that the right half of the DTO reaches the
  // service, since a wrong field here silently creates nobody.
  it('delegates the account-side routes', () => {
    const invite = { authSubjectId: 'a1', phone: '+628', fullName: 'Budi' } as never;
    c.provisionFromInvite(invite);
    expect(emp.provisionFromInvite).toHaveBeenCalledWith(invite);

    const rows = [invite];
    c.provisionManyFromInvite({ rows } as never);
    expect(emp.provisionManyFromInvite).toHaveBeenCalledWith(rows);

    c.setActive({ authSubjectId: 'a1', active: false } as never);
    expect(emp.setActiveInternal).toHaveBeenCalledWith('a1', false);

    c.setDepot({ authSubjectId: 'a1', depotId: 'd2' } as never);
    expect(emp.setDepotInternal).toHaveBeenCalledWith('a1', 'd2');
    // An absent depotId is a move to NO depot, not a missing argument: a role above any
    // single depot legitimately has none, and `?? null` is what keeps that meaning.
    c.setDepot({ authSubjectId: 'a1' } as never);
    expect(emp.setDepotInternal).toHaveBeenLastCalledWith('a1', null);

    c.anonymiseByAccount({ authSubjectId: 'a1' } as never);
    expect(emp.anonymiseByAccount).toHaveBeenCalledWith('a1');

    c.createAccount('e1', user);
    expect(emp.createAccountFor).toHaveBeenCalledWith(user, 'e1');
  });

  it('defaults the import to CREATE and passes UPSERT through when asked', () => {
    const rows = [{ fullName: 'Budi', role: 'STAFF_DEPOT' }] as never;
    c.import({ rows, mode: 'UPSERT' } as never, user);
    expect(emp.importMany).toHaveBeenLastCalledWith(user, rows, 'UPSERT');
    c.import({ rows, mode: undefined } as never, user);
    expect(emp.importMany).toHaveBeenLastCalledWith(user, rows, 'CREATE');
  });
});

describe('FaceController / SelfFaceController', () => {
  it('self enroll decodes each frame and forwards them', () => {
    const face = { enrollSelf: jest.fn().mockResolvedValue('ok') };
    const c = new SelfFaceController(face as never);
    c.enroll({ images: [b64, dataUrl] } as never, user);
    const [passedUser, images] = face.enrollSelf.mock.calls[0];
    expect(passedUser).toBe(user);
    expect(images).toHaveLength(2);
    expect(Buffer.isBuffer(images[0])).toBe(true);
  });
  it('admin enroll decodes frames and forwards id + sourcePhotoUrl', () => {
    const face = { enroll: jest.fn().mockResolvedValue('ok') };
    const c = new FaceController(face as never);
    c.enroll('e1', { images: [b64], sourcePhotoUrl: 'src' } as never, user);
    const [passedUser, id, images, src] = face.enroll.mock.calls[0];
    expect(passedUser).toBe(user);
    expect(id).toBe('e1');
    expect(Buffer.isBuffer(images[0])).toBe(true);
    expect(src).toBe('src');
  });
  it('admin enroll defaults sourcePhotoUrl to null', () => {
    const face = { enroll: jest.fn().mockResolvedValue('ok') };
    const c = new FaceController(face as never);
    c.enroll('e1', { images: [b64] } as never, user);
    expect(face.enroll.mock.calls[0][3]).toBeNull();
  });
});

describe('PayrollController', () => {
  const payroll = svcMock([
    'list',
    'listSelf',
    'getById',
    'getSelfById',
    'slip',
    'selfSlip',
    'generate',
    'approve',
    'markPaid',
  ]);
  const c = new PayrollController(payroll as never);

  it('read routes delegate', () => {
    const q = { page: 1 } as never;
    c.list(q, user);
    // D1: the caller travels with the query — the list is depot-scoped in the service.
    expect(payroll.list).toHaveBeenCalledWith(user, q);
    c.listSelf(q, user);
    expect(payroll.listSelf).toHaveBeenCalledWith(user, q);
    c.getById('p1', user);
    expect(payroll.getById).toHaveBeenCalledWith(user, 'p1');
  });
  it('slip streams a pdf with the right headers', async () => {
    payroll.slip.mockResolvedValue(Buffer.from('pdf'));
    const res = fakeRes();
    await c.slip('p1', user, res);
    expect(payroll.slip).toHaveBeenCalledWith(user, 'p1');
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="slip-p1.pdf"');
    expect(res.send as jest.Mock).toHaveBeenCalled();
  });
  // The self routes exist because `getById`/`slip` above are hrView-gated and no ordinary
  // employee has that capability — see the note on the controller.
  it('self detail + self slip delegate to the ownership-scoped service methods', async () => {
    c.getSelfById('p1', user);
    expect(payroll.getSelfById).toHaveBeenCalledWith(user, 'p1');

    payroll.selfSlip.mockResolvedValue(Buffer.from('pdf'));
    const res = fakeRes();
    await c.selfSlip('p1', user, res);
    expect(payroll.selfSlip).toHaveBeenCalledWith(user, 'p1');
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="slip-p1.pdf"');
  });

  it('generate / approve / pay delegate', () => {
    c.generate({ employeeId: 'e1', periodMonth: '2026-07' } as never, user);
    expect(payroll.generate).toHaveBeenCalledWith(user, 'e1', '2026-07');
    c.approve('p1', user);
    expect(payroll.approve).toHaveBeenCalledWith(user, 'p1');
    c.pay('p1', user);
    expect(payroll.markPaid).toHaveBeenCalledWith(user, 'p1');
  });
});

describe('PerformanceController', () => {
  const perf = svcMock(['listByEmployee', 'upsert', 'score', 'dashboard', 'generate']);
  const c = new PerformanceController(perf as never);
  it('delegates list + upsert', () => {
    c.list({ employeeId: 'e1' } as never, user);
    expect(perf.listByEmployee).toHaveBeenCalledWith(user, 'e1');
    const dto = { employeeId: 'e1', periodMonth: '2026-07' } as never;
    c.upsert(dto, user);
    expect(perf.upsert).toHaveBeenCalledWith(user, dto);
  });

  it('delegates the scoring routes', () => {
    c.score({ employeeId: 'e1', periodMonth: '2026-07' } as never, user);
    expect(perf.score).toHaveBeenCalledWith(user, 'e1', '2026-07');
    c.dashboard({ periodMonth: '2026-07', depotId: 'd1' } as never, user);
    expect(perf.dashboard).toHaveBeenCalledWith(user, '2026-07', 'd1');
    c.generate({ employeeId: 'e1', periodMonth: '2026-07', managerNote: 'bagus' } as never, user);
    expect(perf.generate).toHaveBeenCalledWith(user, 'e1', '2026-07', 'bagus');
  });
});

describe('ReportsController', () => {
  function make() {
    const analytics = {
      dashboard: jest.fn().mockResolvedValue('dash'),
      depotSummary: jest.fn().mockResolvedValue('summary'),
      employeeReport: jest.fn().mockResolvedValue({ headers: ['h'], rows: [['r']] }),
      attendanceReport: jest.fn().mockResolvedValue({ headers: ['h'], rows: [['r']] }),
      payrollReport: jest.fn().mockResolvedValue({ headers: ['h'], rows: [['r']] }),
      depotSummaryMany: jest.fn().mockResolvedValue([]),
      csv: jest.fn().mockReturnValue('a,b\n1,2'),
    };
    return { analytics, c: new ReportsController(analytics as never) };
  }

  it('dashboard + internal depot-summary delegate', () => {
    const { analytics, c } = make();
    const q = { depotId: 'd1' } as never;
    c.dashboard(q, user);
    expect(analytics.dashboard).toHaveBeenCalledWith(user, q);
    c.depotSummary('d1');
    expect(analytics.depotSummary).toHaveBeenCalledWith('d1', undefined);
  });

  // 'YYYY-MM' or nothing. Anything else falls back to the running month rather than 400 —
  // this route feeds a dashboard card, and a blanked panel is the worse failure.
  it.each([
    ['2026-07', '2026-07'],
    ['juli', undefined],
    ['2026-7', undefined],
    ['', undefined],
  ])('passes a period of %s through as %s', (given, expected) => {
    const { analytics, c } = make();
    c.depotSummary('d1', given);
    expect(analytics.depotSummary).toHaveBeenCalledWith('d1', expected);
  });

  // The many-depot variant takes one comma list instead of N round trips; blanks and
  // stray spaces come from the caller joining an array that had a hole in it.
  it('splits the depot-id list, trimming blanks', () => {
    const { analytics, c } = make();
    c.depotSummaries(' d1 , ,d2,');
    expect(analytics.depotSummaryMany).toHaveBeenCalledWith(['d1', 'd2']);

    c.depotSummaries(undefined as never);
    expect(analytics.depotSummaryMany).toHaveBeenLastCalledWith([]);
  });

  it('employees export defaults to CSV with a BOM', async () => {
    const { analytics, c } = make();
    const res = fakeRes();
    await c.employees({ depotId: 'd1' } as never, user, res);
    expect(analytics.employeeReport).toHaveBeenCalledWith(user, 'd1');
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="employees.csv"');
    expect(res.body).toBe('﻿' + 'a,b\n1,2');
  });

  it('attendance export honours xlsx format', async () => {
    const { analytics, c } = make();
    const res = fakeRes();
    await c.attendance(
      { from: '2026-07-01', to: '2026-07-31', format: 'xlsx' } as never,
      user,
      res,
    );
    expect(analytics.attendanceReport).toHaveBeenCalled();
    expect(toXlsx).toHaveBeenCalled();
    expect(res.headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="attendance-2026-07-01_2026-07-31.xlsx"',
    );
    expect(res.body).toEqual(Buffer.from('xlsx-bytes'));
  });

  it('payroll export delegates (csv)', async () => {
    const { analytics, c } = make();
    const res = fakeRes();
    await c.payroll({ periodMonth: '2026-07' } as never, user, res);
    expect(analytics.payrollReport).toHaveBeenCalled();
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="payroll-2026-07.csv"');
  });
});

describe('BonusRuleController / LoanController', () => {
  const rules = svcMock(['list', 'create', 'update']);
  const loans = svcMock(['listByEmployee', 'create', 'deactivate', 'importMany']);
  const rc = new BonusRuleController(rules as never);
  const lc = new LoanController(loans as never);

  it('bonus-rule list maps the depotId sentinel', () => {
    rc.list({ depotId: 'global' } as never);
    expect(rules.list).toHaveBeenLastCalledWith(null);
    rc.list({ depotId: 'd1' } as never);
    expect(rules.list).toHaveBeenLastCalledWith('d1');
    rc.list({} as never);
    expect(rules.list).toHaveBeenLastCalledWith(undefined);
  });
  it('bonus-rule create + update delegate', () => {
    const dto = { name: 'r' } as never;
    rc.create(dto, user);
    expect(rules.create).toHaveBeenCalledWith(user, dto);
    rc.update('r1', dto, user);
    expect(rules.update).toHaveBeenCalledWith(user, 'r1', dto);
  });
  it('loans delegate (asOfPeriod defaults to empty string)', () => {
    lc.list({ employeeId: 'e1' } as never, user);
    expect(loans.listByEmployee).toHaveBeenCalledWith(user, 'e1', '');
    lc.list({ employeeId: 'e1', asOfPeriod: '2026-07' } as never, user);
    expect(loans.listByEmployee).toHaveBeenLastCalledWith(user, 'e1', '2026-07');
    const dto = { employeeId: 'e1', principal: 100 } as never;
    lc.create(dto, user);
    expect(loans.create).toHaveBeenCalledWith(user, dto);
    lc.deactivate('l1', user);
    expect(loans.deactivate).toHaveBeenCalledWith(user, 'l1');
    const rows = [{ employeeCode: 'HR-0001', principal: 100 }] as never;
    lc.import({ rows } as never, user);
    expect(loans.importMany).toHaveBeenCalledWith(user, rows);
  });
});

describe('SettingsController', () => {
  function make() {
    const settings = {
      schema: jest.fn().mockResolvedValue('schema'),
      put: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    };
    return { settings, c: new SettingsController(settings as never) };
  }

  it('schema passes depotId (or null)', () => {
    const { settings, c } = make();
    c.schema('d1');
    expect(settings.schema).toHaveBeenCalledWith('d1');
    c.schema();
    expect(settings.schema).toHaveBeenLastCalledWith(null);
  });

  it('put writes a DEPOT override for a non-super-admin', async () => {
    const { settings, c } = make();
    await c.put({ scope: 'DEPOT', depotId: 'd1', key: 'k', value: 'v' } as never, user);
    expect(settings.put).toHaveBeenCalledWith({
      scope: 'DEPOT',
      depotId: 'd1',
      key: 'k',
      value: 'v',
      updatedBy: 'u1',
    });
  });

  it('put rejects a GLOBAL change from a non-super-admin', async () => {
    const { settings, c } = make();
    await expect(
      c.put({ scope: 'GLOBAL', key: 'k', value: 'v' } as never, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settings.put).not.toHaveBeenCalled();
  });

  it('put allows a GLOBAL change for a super-admin (depotId defaults null)', async () => {
    const { settings, c } = make();
    await c.put({ scope: 'GLOBAL', key: 'k', value: 'v' } as never, superAdmin);
    expect(settings.put).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'GLOBAL', depotId: null }),
    );
  });

  it('reset removes a DEPOT override', async () => {
    const { settings, c } = make();
    await c.reset({ scope: 'DEPOT', depotId: 'd1', key: 'k' } as never, user);
    expect(settings.reset).toHaveBeenCalledWith('DEPOT', 'd1', 'k', 'u1');
  });

  it('reset rejects a GLOBAL change from a non-super-admin', async () => {
    const { settings, c } = make();
    await expect(c.reset({ scope: 'GLOBAL', key: 'k' } as never, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(settings.reset).not.toHaveBeenCalled();
  });

  it('reset allows a GLOBAL change for a super-admin (depotId defaults null)', async () => {
    const { settings, c } = make();
    await c.reset({ scope: 'GLOBAL', key: 'k' } as never, superAdmin);
    expect(settings.reset).toHaveBeenCalledWith('GLOBAL', null, 'k', 'sa');
  });
});
