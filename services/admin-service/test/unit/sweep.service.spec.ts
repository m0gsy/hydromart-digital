import {
  SWEEP_SCHEDULE,
  overdueAfterMinutes,
  verdictFor,
} from '../../src/domain/sweep-schedule';
import { SweepService } from '../../src/application/services/sweep.service';
import { SweepController } from '../../src/modules/sweep.controller';
import { SweepStatusDto } from '../../src/modules/dto/sweep.dto';
import {
  RecordSweepRun,
  SweepRunRecord,
  SweepRunRepository,
} from '../../src/application/ports/sweep-run.repository';

/**
 * CA-5-01 — the observer that makes a stopped sweep visible.
 *
 * Seventeen scheduled sweeps reported into empty marker files inside the scheduler
 * container, and the container healthcheck read exactly ONE of them for all seventeen jobs
 * at once. So a job that had never run was indistinguishable from one that ran a minute
 * ago, as long as some OTHER job had recently succeeded. The cases below are the shapes
 * that hid: never-ran, ran-but-failing, and ran-recently-but-last-worked-days-ago.
 */
class FakeSweepRuns implements SweepRunRepository {
  rows = new Map<string, SweepRunRecord>();

  async record(run: RecordSweepRun): Promise<SweepRunRecord> {
    const previous = this.rows.get(run.job);
    const next: SweepRunRecord = {
      job: run.job,
      host: run.host,
      lastRunAt: run.at,
      ok: run.ok,
      detail: run.detail,
      lastOkAt: run.ok ? run.at : (previous?.lastOkAt ?? null),
      consecutiveFailures: run.ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
    };
    this.rows.set(run.job, next);
    return next;
  }

  async list(): Promise<SweepRunRecord[]> {
    return [...this.rows.values()];
  }
}

const NOW = new Date('2026-09-02T10:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe('sweep schedule (CA-5-01)', () => {
  const live = SWEEP_SCHEDULE.find((s) => !s.dormant)!;
  const dormant = SWEEP_SCHEDULE.find((s) => s.dormant)!;

  it('gives a sweep two whole missed intervals before calling it stopped', () => {
    // A job that merely started late — a slow round, a restart, a tick that overlapped its
    // own lock — must not raise an alarm people then learn to ignore.
    expect(overdueAfterMinutes(10)).toBe(25);
    expect(overdueAfterMinutes(1440)).toBe(2885);
  });

  it('reports a sweep that has never reported as NEVER_RAN, not as missing', () => {
    expect(verdictFor(live, null, NOW)).toBe('NEVER_RAN');
  });

  it('separates "ran" from "worked"', () => {
    const ranAndWorked = { lastRunAt: minutesAgo(1), ok: true };
    const ranAndFailed = { lastRunAt: minutesAgo(1), ok: false };
    expect(verdictFor(live, ranAndWorked, NOW)).toBe('OK');
    // The exact shape the old shared heartbeat rendered as healthy: the round happened and
    // accomplished nothing.
    expect(verdictFor(live, ranAndFailed, NOW)).toBe('FAILING');
  });

  it('reports a sweep that has stopped ticking as OVERDUE', () => {
    const stale = { lastRunAt: minutesAgo(overdueAfterMinutes(live.everyMinutes) + 1), ok: true };
    expect(verdictFor(live, stale, NOW)).toBe('OVERDUE');
  });

  it('does not call a sweep overdue while it is merely a little late', () => {
    const late = { lastRunAt: minutesAgo(live.everyMinutes + 1), ok: true };
    expect(verdictFor(live, late, NOW)).toBe('OK');
  });

  /*
   * Owner decision D9 (2 September 2026): point expiry stays OFF. A switched-off sweep
   * being quiet is a decision, not a fault — and reporting it as one is how somebody
   * "fixes" the row by flipping a switch that writes permanently to every customer's
   * points balance.
   */
  it('reports a deliberately dormant sweep as DORMANT, whatever it last did', () => {
    expect(verdictFor(dormant, null, NOW)).toBe('DORMANT');
    expect(verdictFor(dormant, { lastRunAt: minutesAgo(99_999), ok: false }, NOW)).toBe('DORMANT');
  });

  it('gives every dormant sweep a written reason', () => {
    for (const sweep of SWEEP_SCHEDULE.filter((s) => s.dormant)) {
      expect(sweep.dormant!.length).toBeGreaterThan(20);
    }
  });
});

describe('SweepService', () => {
  let runs: FakeSweepRuns;
  let service: SweepService;

  beforeEach(() => {
    runs = new FakeSweepRuns();
    service = new SweepService(runs);
  });

  it('lists every scheduled sweep even when nothing has ever reported', async () => {
    const all = await service.list(NOW);

    // The whole defect in one assertion: the list is the SCHEDULE, not the table.
    expect(all).toHaveLength(SWEEP_SCHEDULE.length);
    const live = all.filter((s) => s.verdict !== 'DORMANT');
    expect(live.every((s) => s.verdict === 'NEVER_RAN')).toBe(true);
    expect(all.every((s) => s.lastRunAt === null)).toBe(true);
  });

  it('puts the worst first, and a deliberately-off sweep last of all', async () => {
    const [a, b, c] = SWEEP_SCHEDULE.filter((s) => !s.dormant);
    await service.record({ job: a.job, host: 'h', ok: true, detail: null, at: minutesAgo(1) });
    await service.record({ job: b.job, host: 'h', ok: false, detail: 'boom', at: minutesAgo(1) });
    await service.record({
      job: c.job,
      host: 'h',
      ok: true,
      detail: null,
      at: minutesAgo(overdueAfterMinutes(c.everyMinutes) + 1),
    });

    const order = (await service.list(NOW)).map((s) => s.verdict);

    expect(order[0]).toBe('NEVER_RAN');
    expect(order.indexOf('OVERDUE')).toBeLessThan(order.indexOf('FAILING'));
    expect(order.indexOf('FAILING')).toBeLessThan(order.indexOf('OK'));
    expect(order[order.length - 1]).toBe('DORMANT');
  });

  it('keeps the last success when a later round fails', async () => {
    const job = SWEEP_SCHEDULE[0].job;
    await service.record({ job, host: 'h', ok: true, detail: null, at: minutesAgo(30) });
    await service.record({ job, host: 'h', ok: false, detail: 'dead round', at: minutesAgo(1) });

    const row = (await service.list(NOW)).find((s) => s.job === job)!;

    // "Ran a minute ago" and "last worked half an hour ago" are both true and both shown.
    expect(row.lastRunAt).toEqual(minutesAgo(1));
    expect(row.lastOkAt).toEqual(minutesAgo(30));
    expect(row.consecutiveFailures).toBe(1);
    expect(row.detail).toBe('dead round');
  });

  it('counts consecutive failures and clears them on a good round', async () => {
    const job = SWEEP_SCHEDULE[0].job;
    for (let i = 0; i < 3; i += 1) {
      await service.record({ job, host: 'h', ok: false, detail: null, at: minutesAgo(3 - i) });
    }
    expect((await service.list(NOW)).find((s) => s.job === job)!.consecutiveFailures).toBe(3);

    await service.record({ job, host: 'h', ok: true, detail: null, at: NOW });
    expect((await service.list(NOW)).find((s) => s.job === job)!.consecutiveFailures).toBe(0);
  });

  it('ignores a row for a job that is no longer scheduled', async () => {
    await runs.record({ job: 'retired/job', host: 'h', ok: true, detail: null, at: NOW });

    const all = await service.list(NOW);

    // A row nothing schedules would render as permanently overdue and train people to
    // ignore the screen. check-sweep-observer.mjs fails CI on it; this makes it harmless.
    expect(all.map((s) => s.job)).not.toContain('retired/job');
    expect(all).toHaveLength(SWEEP_SCHEDULE.length);
  });

  it('defaults to now when no clock is passed', async () => {
    const all = await service.list();
    expect(all).toHaveLength(SWEEP_SCHEDULE.length);
  });
});

describe('SweepController', () => {
  let service: SweepService;
  let controller: SweepController;

  beforeEach(() => {
    service = new SweepService(new FakeSweepRuns());
    controller = new SweepController(service);
  });

  it('records a heartbeat and answers with the job it stored', async () => {
    const job = SWEEP_SCHEDULE[0].job;
    expect(
      await controller.record({ job, host: 'order:3004', ok: true, detail: 'placed 4' } as never),
    ).toEqual({ job });
  });

  it('treats a heartbeat with no detail as a heartbeat with no detail', async () => {
    const job = SWEEP_SCHEDULE[0].job;
    await controller.record({ job, host: 'order:3004', ok: false } as never);

    const row = (await controller.list()).find((s) => s.job === job)!;
    expect(row.detail).toBeNull();
    expect(row.ok).toBe(false);
  });

  it('serialises dates as ISO strings and never as Date objects', async () => {
    const job = SWEEP_SCHEDULE[0].job;
    await controller.record({ job, host: 'order:3004', ok: true, detail: null } as never);

    const row = (await controller.list()).find((s) => s.job === job)!;
    expect(typeof row.lastRunAt).toBe('string');
    expect(typeof row.lastOkAt).toBe('string');
    expect(row.overdueAfterMinutes).toBe(overdueAfterMinutes(SWEEP_SCHEDULE[0].everyMinutes));
  });

  it('serialises a never-run sweep with nulls rather than omitting it', () => {
    const dto = SweepStatusDto.from({
      job: 'x/y',
      label: 'X',
      everyMinutes: 10,
      verdict: 'NEVER_RAN',
      dormantReason: null,
      lastRunAt: null,
      lastOkAt: null,
      ok: null,
      detail: null,
      consecutiveFailures: 0,
      host: null,
      overdueAfterMinutes: 25,
    });

    expect(dto.lastRunAt).toBeNull();
    expect(dto.lastOkAt).toBeNull();
    expect(dto.verdict).toBe('NEVER_RAN');
  });
});
