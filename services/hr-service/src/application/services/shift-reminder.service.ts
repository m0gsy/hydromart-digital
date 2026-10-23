import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { localDayKey, localMinutesOfDay } from '@hydromart/platform';

import { ShiftAssignment } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import {
  assignmentInForce,
  parseRotationPattern,
  shiftIdForDay,
} from '../../domain/shift-rotation';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../ports/notification.port';
import { SHIFT_REPOSITORY, ShiftRepository } from '../ports/shift.repository';
import { EmployeeService } from './employee.service';

export interface ShiftReminderResult {
  reminded: number;
  skipped: number;
  failed: number;
  ok: boolean;
}

/**
 * "Your shift starts in half an hour", for people HR has put on a rota.
 *
 * Only an explicit assignment counts: a fixed shift, or a weekly rotation that names a shift
 * for today. Everyone else is judged against the depot's default start time, and a default
 * says nothing about whether today is their day off - so they are left alone rather than
 * woken on a Sunday. Off days in a rotation are skipped for the same reason, and anyone with
 * an attendance row today (already in, or on approved leave) is skipped too.
 *
 * Runs every 15 minutes and looks only at shifts starting 30-45 minutes from now, so a shift
 * falls in exactly one tick's window and is mentioned once. ponytail: a skipped tick loses one
 * reminder; national holidays are not known to the rota, so a rota employee can still be
 * reminded on one; a shift starting in the first 45 minutes after local midnight is never
 * reminded (the window would belong to the next day's roster).
 */
@Injectable()
export class ShiftReminderService {
  private readonly logger = new Logger(ShiftReminderService.name);
  private static readonly LEAD_MINUTES = 30;
  private static readonly TICK_MINUTES = 15;
  private static readonly ASSIGNMENT_LIMIT = 5000;

  constructor(
    @Inject(SHIFT_REPOSITORY) private readonly shifts: ShiftRepository,
    @Inject(ATTENDANCE_REPOSITORY) private readonly attendance: AttendanceRepository,
    private readonly employees: EmployeeService,
    private readonly config: HrConfigService,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
  ) {}

  async remindStartingSoon(now: Date = new Date()): Promise<ShiftReminderResult> {
    // A missing port is not an idle round: say the sweep could not do its job.
    if (!this.notifications) return { reminded: 0, skipped: 0, failed: 0, ok: false };

    const tz = this.config.timeZone;
    const workDate = new Date(`${localDayKey(now, tz)}T00:00:00.000Z`);
    const from = localMinutesOfDay(now, tz) + ShiftReminderService.LEAD_MINUTES;
    const to = from + ShiftReminderService.TICK_MINUTES;
    if (to > 24 * 60) return { reminded: 0, skipped: 0, failed: 0, ok: true };

    const all = await this.shifts.listAllAssignmentsUpTo(
      workDate,
      ShiftReminderService.ASSIGNMENT_LIMIT,
    );
    const byEmployee = new Map<string, ShiftAssignment[]>();
    for (const a of all) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);

    const patterns = new Map<string, ReturnType<typeof parseRotationPattern> | null>();
    const starts = new Map<string, string | null>();
    let reminded = 0;
    let skipped = 0;
    let failed = 0;

    for (const [employeeId, assignments] of byEmployee) {
      try {
        const inForce = assignmentInForce(assignments, workDate);
        let pattern: ReturnType<typeof parseRotationPattern> | null = null;
        if (inForce?.rotationId) {
          if (!patterns.has(inForce.rotationId)) {
            const rotation = await this.shifts.findRotationById(inForce.rotationId);
            patterns.set(inForce.rotationId, rotation ? parseRotationPattern(rotation.pattern) : null);
          }
          pattern = patterns.get(inForce.rotationId) ?? null;
        }
        const shiftId = shiftIdForDay(inForce, pattern, workDate);
        if (!shiftId) continue; // a day off, or nothing to go on
        if (!starts.has(shiftId)) {
          starts.set(shiftId, (await this.shifts.findById(shiftId))?.startTime ?? null);
        }
        const startTime = starts.get(shiftId) ?? null;
        const [h, m] = (startTime ?? '').split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        const startMinutes = h * 60 + m;
        if (startMinutes < from || startMinutes >= to) continue;

        // In already, or on approved leave (which writes a LEAVE row): nothing to remind.
        if (await this.attendance.findByEmployeeAndDate(employeeId, workDate)) {
          skipped += 1;
          continue;
        }
        const employee = await this.employees.findByIdInternal(employeeId);
        if (!employee || employee.status !== 'ACTIVE' || !employee.authSubjectId) {
          skipped += 1;
          continue;
        }
        await this.notifications.notify(
          'SHIFT_REMINDER',
          employee.phone,
          { name: employee.fullName, time: startTime as string },
          employee.authSubjectId,
        );
        reminded += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Shift reminder for ${employeeId} failed: ${(error as Error).message}`);
      }
    }
    return { reminded, skipped, failed, ok: failed === 0 || reminded > 0 };
  }
}
