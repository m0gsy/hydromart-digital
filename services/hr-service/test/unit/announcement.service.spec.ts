import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Announcement, AnnouncementRead, Employee } from '../../prisma/generated/client';
import {
  AnnouncementListFilter,
  AnnouncementRepository,
  AnnouncementTargetWrite,
  AnnouncementWithTargets,
  AnnouncementWrite,
  FeedAudience,
} from '../../src/application/ports/announcement.repository';
import { audienceMatches } from '../../src/domain/announcement';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { NotificationPort } from '../../src/application/ports/notification.port';
import { AnnouncementService } from '../../src/application/services/announcement.service';
import { EmployeeService } from '../../src/application/services/employee.service';

const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };

const staff = (over: Partial<Employee> & { id: string }): Employee =>
  ({
    depotId: 'd1',
    departmentId: null,
    position: 'Driver',
    phone: `08-${over.id}`,
    fullName: over.id,
    authSubjectId: `auth-${over.id}`,
    ...over,
  }) as unknown as Employee;

// Budi sits in BOTH depot d1 and department gudang — the overlap case.
const BUDI = staff({ id: 'e1', depotId: 'd1', departmentId: 'gudang' });
const SARI = staff({ id: 'e2', depotId: 'd1', departmentId: 'finance' });
const JOKO = staff({ id: 'e3', depotId: 'd2', departmentId: 'gudang' });
const NO_LOGIN = staff({ id: 'e4', depotId: 'd1', authSubjectId: null });

class FakeRepo implements AnnouncementRepository {
  rows: AnnouncementWithTargets[] = [];
  reads: { announcementId: string; employeeId: string }[] = [];
  private seq = 0;

  async create(
    data: AnnouncementWrite,
    targets: AnnouncementTargetWrite[],
  ): Promise<AnnouncementWithTargets> {
    const row = {
      id: `an-${++this.seq}`,
      publishedAt: null,
      audienceSize: 0,
      ...data,
      targets: targets.map((t, i) => ({ id: `t-${i}`, announcementId: `an-${this.seq}`, ...t })),
    } as unknown as AnnouncementWithTargets;
    this.rows.push(row);
    return row;
  }
  async findById(id: string): Promise<AnnouncementWithTargets | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async list(filter: AnnouncementListFilter) {
    /*
     * CA-1-29: models the real query, not a superset. The DB narrows on BOTH axes before
     * paging, so a fake that only honoured `publishedOnly` would pass against the very
     * leak this closes — a supervisor reading another depot's notices.
     *
     * A COMPANY-targeted row reaches everyone and must survive the depot filter, which is
     * the same rule `targetCovers` applies to the employee feed.
     */
    const rows = this.rows
      .filter((r) => (filter.publishedOnly ? r.publishedAt : true))
      .filter(
        (r) =>
          !filter.depotIds ||
          r.targets.some(
            (t) =>
              t.dimension === 'COMPANY' ||
              (t.dimension === 'DEPOT' && t.value != null && filter.depotIds!.includes(t.value)),
          ),
      );
    return { rows: rows.slice(filter.skip, filter.skip + filter.take), total: rows.length };
  }
  /**
   * Models the real query, not a superset of it (H-18): the DB narrows to notices whose
   * targets cover this person BEFORE `limit` applies. A fake that returns everything and
   * lets the service filter afterwards would pass against the very bug this replaced.
   */
  async listFeedFor(audience: FeedAudience, limit: number): Promise<AnnouncementWithTargets[]> {
    return this.rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          row.publishedAt &&
          audienceMatches(row.targets, {
            id: audience.employeeId,
            depotId: audience.depotId,
            departmentId: audience.departmentId,
            position: audience.position,
          }),
      )
      // Newest first, then `limit` — the real query's order. Modelling it matters: with
      // insertion order the oldest notice survives any window, which is the opposite of
      // the bug and would let the H-18 regression pass unnoticed.
      .sort((a, b) => {
        const byTime = (b.row.publishedAt?.getTime() ?? 0) - (a.row.publishedAt?.getTime() ?? 0);
        return byTime !== 0 ? byTime : b.index - a.index;
      })
      .slice(0, limit)
      .map(({ row }) => row);
  }

  async listDue(now: Date): Promise<AnnouncementWithTargets[]> {
    return this.rows.filter(
      (r) => !r.publishedAt && r.scheduledAt && r.scheduledAt.getTime() <= now.getTime(),
    );
  }
  async markPublished(id: string, publishedAt: Date, audienceSize: number): Promise<Announcement> {
    const row = this.rows.find((r) => r.id === id)!;
    row.publishedAt = publishedAt;
    row.audienceSize = audienceSize;
    return row;
  }
  async markRead(announcementId: string, employeeId: string): Promise<AnnouncementRead> {
    if (
      !this.reads.some((r) => r.announcementId === announcementId && r.employeeId === employeeId)
    ) {
      this.reads.push({ announcementId, employeeId });
    }
    return { readAt: new Date('2026-08-01T00:00:00.000Z') } as AnnouncementRead;
  }
  async countReads(announcementId: string): Promise<number> {
    return this.reads.filter((r) => r.announcementId === announcementId).length;
  }
  async listReadIdsFor(employeeId: string, announcementIds: string[]): Promise<string[]> {
    return this.reads
      .filter((r) => r.employeeId === employeeId && announcementIds.includes(r.announcementId))
      .map((r) => r.announcementId);
  }
}

function make(roster: Employee[] = [BUDI, SARI, JOKO], self: Employee = BUDI, total?: number) {
  const repo = new FakeRepo();
  const employeesRepo = {
    list: jest.fn(async () => ({ rows: roster, total: total ?? roster.length })),
  } as unknown as EmployeeRepository;
  const employees = { getSelf: jest.fn(async () => self) } as unknown as EmployeeService;
  const sent: { event: string; subjectId: string }[] = [];
  const notifications: NotificationPort = {
    notify: jest.fn(async (event, _phone, _vars, subjectId) => {
      sent.push({ event, subjectId });
    }),
  };
  return {
    repo,
    sent,
    notifications,
    employeesRepo,
    svc: new AnnouncementService(repo, employeesRepo, employees, notifications),
  };
}

const DRAFT = { title: 'Libur Idul Adha', body: 'Depot tutup 17 Juni.' };

describe('AnnouncementService (C1)', () => {
  it('publishes immediately and notifies each recipient exactly once', async () => {
    const { svc, sent } = make();
    const out = await svc.create(hr, {
      ...DRAFT,
      // Overlapping on purpose: Budi is in d1 AND in gudang.
      targets: [
        { dimension: 'DEPOT', value: 'd1' },
        { dimension: 'DEPARTMENT', value: 'gudang' },
      ],
    });
    expect(out.publishedAt).toBeTruthy();
    expect(out.audienceSize).toBe(3);
    expect(sent.map((s) => s.subjectId).sort()).toEqual(['auth-e1', 'auth-e2', 'auth-e3']);
    expect(sent.every((s) => s.event === 'HR_ANNOUNCEMENT')).toBe(true);
  });

  it('skips people with no login instead of inventing a subject id', async () => {
    const { svc, sent } = make([BUDI, NO_LOGIN]);
    const out = await svc.create(hr, { ...DRAFT, targets: [{ dimension: 'COMPANY' }] });
    expect(sent.map((s) => s.subjectId)).toEqual(['auth-e1']);
    // They are still part of the audience — they just cannot be paged.
    expect(out.audienceSize).toBe(2);
  });

  // The sweep is ops-triggered and defaults to "now"; a COMPANY target carries no value.
  it('sweeps on the current clock and stores a company target with no value', async () => {
    const { svc, repo } = make();
    await svc.create(hr, { ...DRAFT, targets: [{ dimension: 'COMPANY', value: 'diabaikan' }] });
    expect(repo.rows[0].targets[0]).toMatchObject({ dimension: 'COMPANY', value: null });
    await expect(svc.publishDue()).resolves.toEqual({ published: 0 });
  });

  it('holds a future notice back until the sweep runs', async () => {
    const { svc, sent, repo } = make();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const out = await svc.create(hr, {
      ...DRAFT,
      scheduledAt: future,
      targets: [{ dimension: 'COMPANY' }],
    });
    expect(out.publishedAt).toBeNull();
    expect(sent).toHaveLength(0);

    // Not due yet.
    expect(await svc.publishDue(new Date())).toEqual({ published: 0 });
    expect(sent).toHaveLength(0);

    const after = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(await svc.publishDue(after)).toEqual({ published: 1 });
    expect(sent).toHaveLength(3);
    expect(repo.rows[0].publishedAt).toEqual(after);

    // Running the sweep again does not send it twice.
    expect(await svc.publishDue(after)).toEqual({ published: 0 });
    expect(sent).toHaveLength(3);
  });

  it('treats a schedule already in the past as send-now', async () => {
    const { svc, sent } = make();
    const out = await svc.create(hr, {
      ...DRAFT,
      scheduledAt: '2020-01-01T00:00:00.000Z',
      targets: [{ dimension: 'COMPANY' }],
    });
    expect(out.publishedAt).toBeTruthy();
    expect(sent).toHaveLength(3);
  });

  it('refuses a draft with no audience and one with a valueless non-COMPANY target', async () => {
    const { svc } = make();
    await expect(svc.create(hr, { ...DRAFT, targets: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.create(hr, { ...DRAFT, targets: [{ dimension: 'DEPOT' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create(hr, { ...DRAFT, scheduledAt: 'besok', targets: [{ dimension: 'COMPANY' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops the value from a COMPANY target so it cannot be mistaken for a filter', async () => {
    const { svc, repo } = make();
    await svc.create(hr, {
      ...DRAFT,
      targets: [{ dimension: 'COMPANY', value: 'd1' }],
    });
    expect(repo.rows[0].targets[0].value).toBeNull();
  });

  it('shows an employee only what is addressed to them, with their own read flag', async () => {
    const { svc, repo } = make();
    await svc.create(hr, { ...DRAFT, targets: [{ dimension: 'DEPOT', value: 'd1' }] });
    await svc.create(hr, {
      title: 'Rapat d2',
      body: 'x',
      targets: [{ dimension: 'DEPOT', value: 'd2' }],
    });

    const feed = await svc.listForSelf(hr);
    expect(feed.map((a) => a.title)).toEqual(['Libur Idul Adha']);
    expect(feed[0].read).toBe(false);

    await svc.markRead(hr, feed[0].id);
    expect((await svc.listForSelf(hr))[0].read).toBe(true);
    // Idempotent: reading twice is one read in the statistics.
    await svc.markRead(hr, feed[0].id);
    expect(await repo.countReads(feed[0].id)).toBe(1);
  });

  // H-18: the feed used to be the newest 50 notices COMPANY-WIDE, filtered by audience
  // afterwards. Fifty newer notices aimed elsewhere therefore evicted this employee's own
  // depot notice from the window — they stopped seeing their depot's announcements at
  // all, silently, with no error anywhere. FEED_LIMIT is 50, so 60 is past the edge.
  it("still shows a depot notice buried under 60 newer notices for other depots", async () => {
    const { svc } = make();
    const mine = await svc.create(hr, {
      title: 'Rapat depot d1',
      body: 'x',
      targets: [{ dimension: 'DEPOT', value: 'd1' }],
    });
    for (let i = 0; i < 60; i += 1) {
      await svc.create(hr, {
        title: `Depot d2 #${i}`,
        body: 'x',
        targets: [{ dimension: 'DEPOT', value: 'd2' }],
      });
    }

    const feed = await svc.listForSelf(hr);
    expect(feed.map((a) => a.id)).toEqual([mine.id]);
  });

  it('returns an empty feed rather than querying reads when nothing is addressed to them', async () => {
    const { svc } = make([BUDI], JOKO);
    await svc.create(hr, { ...DRAFT, targets: [{ dimension: 'DEPOT', value: 'd1' }] });
    expect(await svc.listForSelf(hr)).toEqual([]);
  });

  it('will not take a read receipt for a notice that is not theirs, or not out yet', async () => {
    const { svc } = make([BUDI, JOKO], JOKO);
    const mine = await svc.create(hr, {
      ...DRAFT,
      targets: [{ dimension: 'DEPOT', value: 'd1' }],
    });
    await expect(svc.markRead(hr, mine.id)).rejects.toBeInstanceOf(NotFoundException);

    const scheduled = await svc.create(hr, {
      ...DRAFT,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      targets: [{ dimension: 'COMPANY' }],
    });
    await expect(svc.markRead(hr, scheduled.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.markRead(hr, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports read statistics against the audience frozen at publish time', async () => {
    const { svc } = make();
    const out = await svc.create(hr, { ...DRAFT, targets: [{ dimension: 'COMPANY' }] });
    await svc.markRead(hr, out.id);
    expect(await svc.getById(out.id)).toMatchObject({ audienceSize: 3, readCount: 1 });
    await expect(svc.getById('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * CA-1-29. The console list handed everything to everyone with `hrView` — a set that
   * reaches SUPERVISOR and ASSISTANT_SUPERVISOR, each pinned to a single depot. So a
   * supervisor could read HQ's unsent drafts, and every other depot's notices.
   */
  it('keeps drafts away from a reader who cannot write one', async () => {
    const { svc } = make();
    await svc.create(hr, { title: 'sent', body: 'x', targets: [{ dimension: 'COMPANY' }] });
    await svc.create(hr, {
      title: 'draft',
      body: 'x',
      targets: [{ dimension: 'COMPANY' }],
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    // HR writes announcements, so HR sees the draft it is still working on.
    expect((await svc.list(hr)).rows).toHaveLength(2);

    const spv: AuthenticatedUser = {
      sub: 'spv-1',
      role: 'SUPERVISOR' as never,
      phone: null,
      depotId: 'd1',
    };
    const seen = (await svc.list(spv)).rows;
    expect(seen.map((r) => r.title)).toEqual(['sent']);
  });

  it("keeps another depot's notices away from a depot-scoped reader", async () => {
    const { svc } = make();
    await svc.create(hr, { title: 'for-d1', body: 'x', targets: [{ dimension: 'DEPOT', value: 'd1' }] });
    await svc.create(hr, { title: 'for-d2', body: 'x', targets: [{ dimension: 'DEPOT', value: 'd2' }] });
    await svc.create(hr, { title: 'everyone', body: 'x', targets: [{ dimension: 'COMPANY' }] });

    const spv: AuthenticatedUser = {
      sub: 'spv-1',
      role: 'SUPERVISOR' as never,
      phone: null,
      depotId: 'd1',
    };
    const titles = (await svc.list(spv)).rows.map((r) => r.title).sort();
    // The company-wide notice survives; the other depot's does not.
    expect(titles).toEqual(['everyone', 'for-d1']);

    // HR sits above depots, so HR still sees the whole network — that is their job.
    expect((await svc.list(hr)).rows).toHaveLength(3);
  });

  it('pages the console list', async () => {
    const { svc } = make();
    for (let i = 0; i < 3; i++) {
      await svc.create(hr, { title: `n${i}`, body: 'x', targets: [{ dimension: 'COMPANY' }] });
    }
    // CA-1-29: who is asking now decides what comes back, so the caller travels with it.
    expect(await svc.list(hr, 2, 2)).toMatchObject({ total: 3 });
    expect((await svc.list(hr)).rows).toHaveLength(3);
  });

  it('warns instead of silently reaching fewer people than the roster holds', async () => {
    const { svc } = make([BUDI], BUDI, 9000);
    const warn = jest.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
    await svc.create(hr, { ...DRAFT, targets: [{ dimension: 'COMPANY' }] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('audience truncated'));
  });

  it('publishes without a notification port bound at all', async () => {
    const repo = new FakeRepo();
    const employeesRepo = {
      list: jest.fn(async () => ({ rows: [BUDI], total: 1 })),
    } as unknown as EmployeeRepository;
    const employees = { getSelf: jest.fn(async () => BUDI) } as unknown as EmployeeService;
    const svc = new AnnouncementService(repo, employeesRepo, employees);
    const out = await svc.create(hr, { ...DRAFT, targets: [{ dimension: 'COMPANY' }] });
    expect(out.publishedAt).toBeTruthy();
    expect(out.audienceSize).toBe(1);
  });
});
