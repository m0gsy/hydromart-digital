import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { localDayKey, localMinutesOfDay } from '@hydromart/platform';

import { ShiftAssignment } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { addDays } from '../../domain/depot-on';
import {
  assignmentInForce,
  parseRotationPattern,
  shiftIdForDay,
} from '../../domain/shift-rotation';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { HOLIDAY_REPOSITORY, HolidayRepository } from '../ports/holiday.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../ports/notification.port';
import { SHIFT_REPOSITORY, ShiftRepository } from '../ports/shift.repository';
import { EmployeeService } from './employee.service';

export interface ShiftReminderResult {
  reminded: number;
  skipped: number;
  failed: number;
  ok: boolean;
}

/** One local day's slice of the reminder window, in minutes from that day's midnight. */
interface DaySegment {
  workDate: Date;
  from: number;
  to: number;
}

type Pattern = ReturnType<typeof parseRotationPattern>;

/**
 * "Your shift starts in half an hour", for people HR has put on a rota.
 *
 * Only an explicit assignment counts: a fixed shift, or a weekly rotation that names a shift
 * for that day. Everyone else is judged against the depot's default start time, and a default
 * says nothing about whether the day is their day off - so they are left alone rather than
 * woken on a Sunday. Rotation day-offs are skipped for the same reason, as are public
 * holidays (the depot's own and national, the same calendar payroll uses), and anyone with
 * an attendance row for the day (already in, or on approved leave).
 *
 * Runs every 15 minutes and looks only at shifts starting 30-45 minutes from now, so a shift
 * falls in exactly one tick's window and is mentioned once. Near midnight that window spills
 * into the next local day, whose roster is then read instead: a 00:10 shift is reminded at
 * 23:40 on the previous evening. ponytail: a skipped tick loses one reminder - the
 * `shift_reminders` marker table closes that (see the follow-up migration PR).
 */
@Injectable()
export class ShiftReminderService {
  private readonly logger = new Logger(ShiftReminderService.name);
  private static readonly LEAD_MINUTES = 30;
  private static readonly TICK_MINUTES = 15;
  private static readonly DAY_MINUTES = 24 * 60;
  private static readonly ASSIGNMENT_LIMIT = 5000;

  constructor(
    @Inject(SHIFT_REPOSITORY) private readonly shifts: ShiftRepository,
    @Inject(ATTENDANCE_REPOSITORY) private readonly attendance: AttendanceRepository,
    private readonly employees: EmployeeService,
    private readonly config: HrConfigService,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
    @Optional() @Inject(HOLIDAY_REPOSITORY) private readonly holidays?: HolidayRepository,
  ) {}

  /** The window as one or two local-day slices; the second exists only across midnight. */
  private segments(now: Date): DaySegment[] {
    const tz = this.config.timeZone;
    const todayKey = localDayKey(now, tz);
    const today = new Date(`${todayKey}T00:00:00.000Z`);
    const from = localMinutesOfDay(now, tz) + ShiftReminderService.LEAD_MINUTES;
    const to = from + ShiftReminderService.TICK_MINUTES;
    const day = ShiftReminderService.DAY_MINUTES;
    if (to <= day) return [{ workDate: today, from, to }];
    const tomorrow = new Date(`${addDays(todayKey, 1)}T00:00:00.000Z`);
    if (from >= day) return [{ workDate: tomorrow, from: from - day, to: to - day }];
    return [
      { workDate: today, from, to: day },
      { workDate: tomorrow, from: 0, to: to - day },
    ];
  }

  async remindStartingSoon(now: Date = new Date()): Promise<ShiftReminderResult> {
    // A missing port is not an idle round: say the sweep could not do its job.
    if (!this.notifications) return { reminded: 0, skipped: 0, failed: 0, ok: false };

    const segments = this.segments(now);
    const latest = segments[segments.length - 1]!.workDate;
    const all = await this.shifts.listAllAssignmentsUpTo(
      latest,
      ShiftReminderService.ASSIGNMENT_LIMIT,
    );
    const byEmployee = new Map<string, ShiftAssignment[]>();
    for (const a of all) byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);

    const patterns = new Map<string, Pattern | null>();
    const starts = new Map<string, string | null>();
    let reminded = 0;
    let skipped = 0;
    let failed = 0;

    for (const [employeeId, assignments] of byEmployee) {
      for (const segment of segments) {
        try {
          const startTime = await this.startTimeInWindow(assignments, segment, patterns, starts);
          if (!startTime) continue;

          // In already, or on approved leave (which writes a LEAVE row): nothing to remind.
          if (await this.attendance.findByEmployeeAndDate(employeeId, segment.workDate)) {
            skipped += 1;
            continue;
          }
          const employee = await this.employees.findByIdInternal(employeeId);
          if (!employee || employee.status !== 'ACTIVE' || !employee.authSubjectId) {
            skipped += 1;
            continue;
          }
          if (await this.isHoliday(employee.depotId, segment.workDate)) {
            skipped += 1;
            continue;
          }
          await this.notifications.notify(
            'SHIFT_REMINDER',
            employee.phone,
            { name: employee.fullName, time: startTime },
            employee.authSubjectId,
          );
          reminded += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(`Shift reminder for ${employeeId} failed: ${(error as Error).message}`);
        }
      }
    }
    return { reminded, skipped, failed, ok: failed === 0 || reminded > 0 };
  }

  /** The shift's start time when this employee works one that starts inside the segment. */
  private async startTimeInWindow(
    assignments: ShiftAssignment[],
    segment: DaySegment,
    patterns: Map<string, Pattern | null>,
    starts: Map<string, string | null>,
  ): Promise<string | null> {
    const inForce = assignmentInForce(assignments, segment.workDate);
    let pattern: Pattern | null = null;
    if (inForce?.rotationId) {
      if (!patterns.has(inForce.rotationId)) {
        const rotation = await this.shifts.findRotationById(inForce.rotationId);
        patterns.set(inForce.rotationId, rotation ? parseRotationPattern(rotation.pattern) : null);
      }
      pattern = patterns.get(inForce.rotationId) ?? null;
    }
    const shiftId = shiftIdForDay(inForce, pattern, segment.workDate);
    if (!shiftId) return null; // a day off, or nothing to go on
    if (!starts.has(shiftId)) {
      starts.set(shiftId, (await this.shifts.findById(shiftId))?.startTime ?? null);
    }
    const startTime = starts.get(shiftId) ?? null;
    const [h, m] = (startTime ?? '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    const minutes = (h as number) * 60 + (m as number);
    return minutes >= segment.from && minutes < segment.to ? startTime : null;
  }

  /** Public holiday for this employee's depot: national, or the depot's own. */
  private async isHoliday(depotId: string | null, workDate: Date): Promise<boolean> {
    if (!this.holidays) return false;
    return (await this.holidays.listDates(depotId, workDate, workDate)).length > 0;
  }
}
