import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { alertServerError, localDayKey, localHour } from '@hydromart/platform';

import { HrConfigService } from '../../config/hr-config.service';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';

/**
 * Face plan PR-2: a punch held PENDING (a late offline sync, or a face the engine could not
 * judge) counts as nothing until HR decides it, and a daily worker is not paid for that day.
 * The queue had no alarm at all. This tells ops, at most once a day in the 09:00 hour of the
 * business day, while any punch has waited more than 48 hours.
 *
 * ponytail: the once-a-day memory is this process's; a restart inside the 09:00 hour can send
 * a second message that morning. Persist the last alert if that ever matters.
 */
@Injectable()
export class PendingPunchAlert implements OnApplicationBootstrap {
  static readonly MAX_WAIT_MS = 48 * 3_600_000;
  static readonly ALERT_HOUR = 9;
  static readonly LOOK_MS = 15 * 60_000;
  private readonly logger = new Logger(PendingPunchAlert.name);
  private lastAlertDay: string | null = null;

  constructor(
    @Inject(ATTENDANCE_REPOSITORY) private readonly repo: AttendanceRepository,
    private readonly config: HrConfigService,
  ) {}

  onApplicationBootstrap(): void {
    // Every 15 minutes: the 09:00 hour always gets several looks however the timer drifts, and
    // lastAlertDay keeps it to one message. Unref'd, so it never holds the process.
    setInterval(() => void this.tick(), PendingPunchAlert.LOOK_MS).unref();
  }

  /** One look. True when it alerted. Never throws: a failed look must not take hr down. */
  async tick(now: Date = new Date()): Promise<boolean> {
    try {
      const tz = this.config.timeZone;
      const day = localDayKey(now, tz);
      if (localHour(now, tz) !== PendingPunchAlert.ALERT_HOUR || this.lastAlertDay === day) {
        return false;
      }
      const waiting = await this.repo.countPendingOlderThan(
        new Date(now.getTime() - PendingPunchAlert.MAX_WAIT_MS),
      );
      if (waiting === 0) return false;
      this.lastAlertDay = day;
      alertServerError({
        method: 'GET',
        path: '/api/v1/attendance?status=PENDING (HR decision queue)',
        status: 503,
        exception: new Error(
          `${waiting} absen PENDING menunggu keputusan HR lebih dari 48 jam. ` +
            'Staf harian tidak dibayar untuk hari yang masih PENDING.',
        ),
      });
      return true;
    } catch (e) {
      this.logger.warn(`PENDING check failed: ${(e as Error).message}`);
      return false;
    }
  }
}
