import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee } from '../../prisma/generated/client';
import { AttendanceService } from '../../src/application/services/attendance.service';
import { AttendanceRepository, ManualAttendanceInput } from '../../src/application/ports/attendance.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';

const user: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };
const employee = { id: 'e1', depotId: 'd1' } as Employee;
const row = { id: 'a1', employeeId: 'e1', depotId: 'd1', workDate: new Date('2026-07-01T00:00:00Z'), status: 'ABSENT', lateMinutes: 0, checkInAt: null, checkOutAt: null } as Attendance;

function build() {
  const adjustments: { before: unknown; after: unknown; reason: string }[] = [];
  let lastUpsert: ManualAttendanceInput | undefined;
  const repo = {
    findById: async (id: string) => (id === 'a1' ? row : null),
    findByEmployeeAndDate: async () => null,
    upsertManual: async (input: ManualAttendanceInput) => {
      lastUpsert = input;
      return { ...row, status: input.status } as Attendance;
    },
    recordAdjustment: async (d: { before: unknown; after: unknown; reason: string }) => void adjustments.push(d),
  } as unknown as AttendanceRepository;
  const employees = { findById: async () => employee } as unknown as EmployeeRepository;
  const svc = new AttendanceService(repo, {} as never, {} as never, employees, {} as never);
  return { svc, adjustments, upsert: () => lastUpsert };
}

describe('AttendanceService manual override', () => {
  it('adjust applies the new status and records a before/after audit row', async () => {
    const { svc, adjustments, upsert } = build();
    const out = await svc.adjust(user, 'a1', { status: 'LEAVE', reason: 'cuti disetujui' });
    expect(out.status).toBe('LEAVE');
    expect(upsert()?.status).toBe('LEAVE');
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ reason: 'cuti disetujui' });
    expect((adjustments[0].before as { status: string }).status).toBe('ABSENT');
    expect((adjustments[0].after as { status: string }).status).toBe('LEAVE');
  });

  it('adjust 404s an unknown attendance id', async () => {
    const { svc } = build();
    await expect(svc.adjust(user, 'nope', { status: 'LEAVE', reason: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createManual upserts a day (no check-in) and audits it', async () => {
    const { svc, adjustments, upsert } = build();
    const out = await svc.createManual(user, { employeeId: 'e1', workDate: '2026-07-02', status: 'HOLIDAY', reason: 'libur depot' });
    expect(out.status).toBe('HOLIDAY');
    expect(upsert()?.employeeId).toBe('e1');
    expect(adjustments).toHaveLength(1);
  });
});
