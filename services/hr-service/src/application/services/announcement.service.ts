import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import {
  Announcement,
  AnnouncementDimension,
  AnnouncementLevel,
  Employee,
} from '../../../prisma/generated/client';
import { AudienceTarget, audienceMatches, resolveAudience } from '../../domain/announcement';
import {
  ANNOUNCEMENT_REPOSITORY,
  AnnouncementRepository,
  AnnouncementWithTargets,
} from '../ports/announcement.repository';
import { EMPLOYEE_REPOSITORY, EmployeeRepository } from '../ports/employee.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../ports/notification.port';
import { EmployeeService } from './employee.service';

/**
 * Ceiling on one announcement's audience. Well above any real depot network; it exists so a
 * misconfigured COMPANY target cannot try to page every row in the table at once. When it
 * bites, the sweep says so rather than quietly reaching fewer people than it reports.
 */
const AUDIENCE_LIMIT = 5000;

/** Feed depth for one employee. Older notices stay readable from the HR console. */
const FEED_LIMIT = 50;

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  level?: AnnouncementLevel;
  scheduledAt?: string;
  targets: { dimension: AnnouncementDimension; value?: string | null }[];
}

export interface AnnouncementStats {
  audienceSize: number;
  readCount: number;
}

/**
 * Announcements from HR to staff. Two things make this more than a CRUD table:
 *
 * 1. Overlapping targets must reach a person ONCE — resolved in domain/announcement.ts.
 * 2. A scheduled notice is not sent by a timer inside this service. It waits for the
 *    publish-due sweep endpoint, the same shape as order-service's expireAbandoned, so
 *    exactly one process decides when work happens no matter how many replicas run.
 */
@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    @Inject(ANNOUNCEMENT_REPOSITORY) private readonly repo: AnnouncementRepository,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeesRepo: EmployeeRepository,
    private readonly employees: EmployeeService,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
  ) {}

  // ── HR side ─────────────────────────────────────────────────────────

  async create(
    user: AuthenticatedUser,
    input: CreateAnnouncementInput,
  ): Promise<AnnouncementWithTargets> {
    if (input.targets.length === 0) {
      // No target is not "everyone" — COMPANY says everyone, explicitly.
      throw new BadRequestException('Pilih minimal satu target audiens');
    }
    for (const target of input.targets) {
      if (target.dimension !== 'COMPANY' && !target.value) {
        throw new BadRequestException(`Target ${target.dimension} membutuhkan nilai`);
      }
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt bukan tanggal yang sah');
    }

    const announcement = await this.repo.create(
      {
        title: input.title,
        body: input.body,
        level: input.level ?? 'INFO',
        scheduledAt,
        createdBy: user.sub,
      },
      input.targets.map((t) => ({
        dimension: t.dimension,
        value: t.dimension === 'COMPANY' ? null : (t.value ?? null),
      })),
    );

    // A schedule in the past is a send-now with extra typing; only a future one waits.
    if (!scheduledAt || scheduledAt.getTime() <= Date.now()) {
      await this.publish(announcement);
    }
    return (await this.repo.findById(announcement.id)) ?? announcement;
  }

  async list(page = 1, pageSize = 20) {
    return this.repo.list({ skip: (page - 1) * pageSize, take: pageSize });
  }

  async getById(id: string): Promise<AnnouncementWithTargets & AnnouncementStats> {
    const announcement = await this.get(id);
    return { ...announcement, ...(await this.stats(announcement)) };
  }

  /**
   * Release everything whose schedule has come due. Returns how many went out so the caller
   * (an ops sweep, a cron outside the service) can see it did something.
   */
  async publishDue(now = new Date()): Promise<{ published: number }> {
    const due = await this.repo.listDue(now);
    let published = 0;
    for (const announcement of due) {
      await this.publish(announcement, now);
      published += 1;
    }
    return { published };
  }

  // ── employee side ───────────────────────────────────────────────────

  /** One employee's feed: published notices whose audience covers them, newest first. */
  async listForSelf(
    user: AuthenticatedUser,
  ): Promise<(AnnouncementWithTargets & { read: boolean })[]> {
    const employee = await this.employees.getSelf(user);
    // H-18: the feed used to be the newest FEED_LIMIT notices company-wide, filtered by
    // audience afterwards — so once other depots had published 50 newer notices, an
    // employee stopped seeing their OWN depot's announcements entirely. The query is
    // scoped to them now; audienceMatches stays as the authoritative second pass so the
    // domain rule, not the SQL, decides what "covers" means.
    const published = await this.repo.listFeedFor(
      {
        employeeId: employee.id,
        depotId: employee.depotId,
        departmentId: employee.departmentId,
        position: employee.position,
      },
      FEED_LIMIT,
    );
    const mine = published.filter((a) => audienceMatches(a.targets, employee));
    if (mine.length === 0) return [];
    const readIds = new Set(
      await this.repo.listReadIdsFor(
        employee.id,
        mine.map((a) => a.id),
      ),
    );
    return mine.map((a) => ({ ...a, read: readIds.has(a.id) }));
  }

  async markRead(user: AuthenticatedUser, id: string): Promise<{ readAt: Date }> {
    const employee = await this.employees.getSelf(user);
    const announcement = await this.get(id);
    if (!announcement.publishedAt || !audienceMatches(announcement.targets, employee)) {
      // Not addressed to them: a read receipt would be a lie in the statistics.
      throw new NotFoundException('Pengumuman tidak ditemukan');
    }
    const row = await this.repo.markRead(id, employee.id);
    return { readAt: row.readAt };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async get(id: string): Promise<AnnouncementWithTargets> {
    const announcement = await this.repo.findById(id);
    if (!announcement) throw new NotFoundException('Pengumuman tidak ditemukan');
    return announcement;
  }

  private async stats(announcement: Announcement): Promise<AnnouncementStats> {
    return {
      audienceSize: announcement.audienceSize,
      readCount: await this.repo.countReads(announcement.id),
    };
  }

  /**
   * Resolve, notify once per person, then stamp it live with the audience frozen in. The
   * notification port is fail-open by construction (A2), so a WhatsApp outage cannot leave
   * an announcement half-published.
   */
  private async publish(announcement: AnnouncementWithTargets, at = new Date()): Promise<void> {
    const recipients = await this.audienceFor(announcement.targets);
    for (const person of recipients) {
      if (!this.notifications || !person.authSubjectId) continue;
      await this.notifications.notify(
        'HR_ANNOUNCEMENT',
        person.phone,
        { title: announcement.title, body: announcement.body, level: announcement.level },
        person.authSubjectId,
      );
    }
    await this.repo.markPublished(announcement.id, at, recipients.length);
  }

  private async audienceFor(targets: readonly AudienceTarget[]): Promise<Employee[]> {
    const { rows, total } = await this.employeesRepo.list({
      status: 'ACTIVE',
      skip: 0,
      take: AUDIENCE_LIMIT,
    });
    if (total > rows.length) {
      this.logger.warn(
        `audience truncated: ${total} active employees, only the first ${rows.length} considered`,
      );
    }
    return resolveAudience(targets, rows);
  }
}
