import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { ReportCadence } from '../../src/domain/report-cadence';
import { ReportDataset } from '../../src/domain/report-dataset';
import { revenueTable } from '../../src/domain/report-table';
import { nextRunAfter, reportWindow } from '../../src/domain/report-window';
import { renderReport, reportFileName } from '../../src/domain/report-file';
import { ScheduledReportRunnerService } from '../../src/application/services/scheduled-report-runner.service';
import { InMemoryExportLogRepository, InMemoryScheduledReportRepository } from '../support/fakes';

/*
 * The executor that did not exist. `hq/scheduled-reports` had full CRUD, `nextRunAt` was
 * documented as "advisory metadata for the future scheduler", and nothing ever produced a
 * file — which is also why `hq/exports` was permanently empty: nothing wrote a log either.
 */

const WED = new Date('2026-08-12T03:00:00.000Z'); // a Wednesday

function makeRunner(rowsFor: jest.Mock) {
  const schedules = new InMemoryScheduledReportRepository();
  const logs = new InMemoryExportLogRepository();
  const mailer = { send: jest.fn().mockResolvedValue(true) };
  const runner = new ScheduledReportRunnerService(
    schedules,
    logs,
    {
      rowsFor,
      tableFor: async (d: ReportDataset, f: Date, t: Date) => revenueTable(await rowsFor(d, f, t)),
    } as never,
    mailer,
  );
  return { schedules, logs, runner, mailer };
}

describe('reportWindow', () => {
  /*
   * A report must describe a period that has FINISHED. Reporting on the period it is
   * running inside would produce a file whose numbers change every time it is generated,
   * which is the one thing a scheduled report cannot do.
   */
  it('reports yesterday for DAILY, not the partial day it runs in', () => {
    expect(reportWindow(ReportCadence.DAILY, WED)).toEqual({
      from: new Date('2026-08-10T17:00:00.000Z'), // Tue 11 Aug 00:00 WIB
      to: new Date('2026-08-11T17:00:00.000Z'), // Wed 12 Aug 00:00 WIB
    });
  });

  it('reports last Monday-to-Monday for WEEKLY', () => {
    expect(reportWindow(ReportCadence.WEEKLY, WED)).toEqual({
      from: new Date('2026-08-02T17:00:00.000Z'), // Mon 3 Aug 00:00 WIB
      to: new Date('2026-08-09T17:00:00.000Z'), // Mon 10 Aug 00:00 WIB
    });
  });

  // Sunday is getUTCDay() 0, so a naive "days since Monday" would call it day zero and
  // report the week that has not finished.
  it('treats Sunday as the END of a week, not the start', () => {
    const sunday = new Date('2026-08-09T03:00:00.000Z');
    expect(reportWindow(ReportCadence.WEEKLY, sunday)).toEqual({
      from: new Date('2026-07-26T17:00:00.000Z'), // Mon 27 Jul 00:00 WIB
      to: new Date('2026-08-02T17:00:00.000Z'), // Mon 3 Aug 00:00 WIB
    });
  });

  it('reports last calendar month for MONTHLY', () => {
    expect(reportWindow(ReportCadence.MONTHLY, WED)).toEqual({
      from: new Date('2026-06-30T17:00:00.000Z'), // 1 Jul 00:00 WIB
      to: new Date('2026-07-31T17:00:00.000Z'), // 1 Aug 00:00 WIB
    });
  });

  it('rolls a December monthly window into the previous year', () => {
    const jan = new Date('2026-01-05T03:00:00.000Z');
    expect(reportWindow(ReportCadence.MONTHLY, jan).from).toEqual(
      new Date('2025-11-30T17:00:00.000Z'), // 1 Dec 00:00 WIB
    );
  });

  // The reason the window moved. An order at 01:00 WIB on 12 Aug is 18:00 UTC on 11 Aug. The
  // dashboards file it under 12 Aug; a UTC-midnight window filed it under 11 Aug, so the daily
  // file and the screen disagreed about that order every single day.
  it('puts an order placed at 01:00 WIB inside the WIB day it belongs to', () => {
    const order = new Date('2026-08-11T18:00:00.000Z'); // Wed 12 Aug 01:00 WIB
    const ranOnThe13th = new Date('2026-08-13T03:00:00.000Z'); // Thu 13 Aug 10:00 WIB
    const { from, to } = reportWindow(ReportCadence.DAILY, ranOnThe13th); // covers Wed 12 Aug
    expect(order >= from && order < to).toBe(true);
    const ranOnThe12th = reportWindow(ReportCadence.DAILY, WED); // covers Tue 11 Aug
    expect(order >= ranOnThe12th.from && order < ranOnThe12th.to).toBe(false);
  });

  // 17:30 UTC on Sunday is 00:30 WIB on MONDAY: the week has already turned over in WIB.
  it('turns the week over at Monday 00:00 WIB, not at 07:00 WIB', () => {
    const justAfterMidnightWib = new Date('2026-08-09T17:30:00.000Z'); // Mon 10 Aug 00:30 WIB
    expect(reportWindow(ReportCadence.WEEKLY, justAfterMidnightWib)).toEqual({
      from: new Date('2026-08-02T17:00:00.000Z'), // Mon 3 Aug
      to: new Date('2026-08-09T17:00:00.000Z'), // Mon 10 Aug
    });
  });
});

describe('nextRunAfter', () => {
  it.each([
    [ReportCadence.DAILY, '2026-08-12T17:00:00.000Z'], // Thu 13 Aug 00:00 WIB
    [ReportCadence.WEEKLY, '2026-08-16T17:00:00.000Z'], // Mon 17 Aug 00:00 WIB
    [ReportCadence.MONTHLY, '2026-08-31T17:00:00.000Z'], // Tue 1 Sep 00:00 WIB
  ])('gives the next %s boundary', (cadence, expected) => {
    expect(nextRunAfter(cadence, WED)).toEqual(new Date(expected));
  });
});

describe('renderReport', () => {
  const rows = [{ label: 'Depot Cibubur', orders: 3, revenue: 90000 }];

  it('writes a CSV with a header and a BOM so Excel reads it as UTF-8', async () => {
    const text = (await renderReport(rows, ExportFormat.CSV, 'x')).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Label,Pesanan,Pendapatan');
    expect(text).toContain('Depot Cibubur,3,90000');
  });

  /*
   * ADM-9: these labels are product and depot names typed by staff, and Excel and Sheets
   * run a cell that starts with `=`, `+`, `-` or `@`. `=HYPERLINK(...)` posting the row to
   * a URL executes when head office opens the scheduled report; no macros needed.
   */
  it.each(['=WEBSERVICE(X)', '+1+1', '-2+3', '@SUM(A1)', '	=CMD'])(
    'neutralises a label that a spreadsheet would run: %s',
    async (label) => {
      const text = (
        await renderReport([{ label, orders: 1, revenue: 1 }], ExportFormat.CSV, 'x')
      ).toString('utf8');
      // The apostrophe every spreadsheet understands: shown as typed, evaluated never.
      expect(text).toContain(`'${label}`);
    },
  );

  // The quoting and the neutralising have to survive each other: this one needs both.
  it('neutralises a formula that also has to be quoted', async () => {
    const text = (
      await renderReport(
        [{ label: '=HYPERLINK("http://x","klik")', orders: 1, revenue: 1 }],
        ExportFormat.CSV,
        'x',
      )
    ).toString('utf8');
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""klik"")",1,1`);
  });

  it('leaves an ordinary label untouched', async () => {
    const text = (
      await renderReport([{ label: 'Depot Cibubur', orders: 1, revenue: 1 }], ExportFormat.CSV, 'x')
    ).toString('utf8');
    expect(text).not.toContain("'Depot");
  });

  // A depot called `Depot "Baru", Cibubur` must stay one column.
  it('quotes a label containing a comma or a quote', async () => {
    const text = (
      await renderReport(
        [{ label: 'Depot "Baru", Cibubur', orders: 1, revenue: 1 }],
        ExportFormat.CSV,
        'x',
      )
    ).toString('utf8');
    expect(text).toContain('"Depot ""Baru"", Cibubur",1,1');
  });

  // Generous timeout: this is the one test that loads exceljs for real, and the first
  // require of it costs seconds. Mocking it away would leave nothing proving the writer
  // produces a workbook rather than a plausible-looking buffer.
  it('writes a real xlsx workbook', async () => {
    const buf = await renderReport(rows, ExportFormat.XLSX, 'Laporan');
    // PK zip magic — an .xlsx is a zip, so this proves a workbook and not a stub.
    expect(buf.subarray(0, 2).toString('utf8')).toBe('PK');
  }, 30_000);

  it('writes a real PDF', async () => {
    const pdf = await renderReport(rows, ExportFormat.PDF, 'Laporan Harian');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  // pdfkit writes each text call as one `[<hex> kern <hex> …] TJ` operator — the same
  // extraction order-service's PDF tests use, since there is no PDF parser dependency here.
  it('prints the sheet title, every row, and a summed total', async () => {
    const pdf = await renderReport(
      [...rows, { label: 'Depot Pekayon', orders: 2, revenue: 60000 }],
      ExportFormat.PDF,
      'Laporan Harian',
      { pdfCompress: false },
    );
    const cells: string[] = [];
    for (const m of pdf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      cells.push(
        [...m[1].matchAll(/<([0-9a-f]*)>/g)]
          .map((h) => Buffer.from(h[1], 'hex').toString('latin1'))
          .join(''),
      );
    }
    expect(cells).toContain('Laporan Harian');
    expect(cells).toEqual(expect.arrayContaining(['Depot Cibubur', '3', 'Rp90.000']));
    expect(cells).toEqual(expect.arrayContaining(['Depot Pekayon', '2', 'Rp60.000']));
    expect(cells).toEqual(expect.arrayContaining(['Total', '5', 'Rp150.000']));
  });

  it('says so when there are no rows, rather than printing an empty table', async () => {
    const pdf = await renderReport([], ExportFormat.PDF, 'Laporan Harian', {
      pdfCompress: false,
    });
    const cells: string[] = [];
    for (const m of pdf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      cells.push(
        [...m[1].matchAll(/<([0-9a-f]*)>/g)]
          .map((h) => Buffer.from(h[1], 'hex').toString('latin1'))
          .join(''),
      );
    }
    expect(cells).toContain('Tidak ada data pada periode ini.');
    expect(cells).not.toContain('Total');
  });

  it('names the file after the window, not the run time', () => {
    expect(
      reportFileName('Laporan Harian!', new Date('2026-08-10T17:00:00.000Z'), ExportFormat.CSV),
    ).toBe('laporan-harian-2026-08-11.csv');
  });

  it('falls back to a usable name when the title has no letters at all', () => {
    expect(reportFileName('!!!', new Date('2026-08-10T17:00:00.000Z'), ExportFormat.XLSX)).toBe(
      'laporan-2026-08-11.xlsx',
    );
  });
});

describe('ScheduledReportRunnerService', () => {
  // findDue is a plain read, so two replicas (or a slow tick overlapping the next, or a manual
  // trigger) each picked up the same schedule, produced the same file and emailed it twice.
  // The run is now claimed first: the loser skips the schedule and sends nothing.
  describe('claiming a run', () => {
    const create = (schedules: InMemoryScheduledReportRepository) =>
      schedules.create({
        name: 'Harian',
        cadence: ReportCadence.DAILY,
        recipients: ['finance@hydromart.id'],
        format: ExportFormat.CSV,
        dataset: ReportDataset.REVENUE_BY_PRODUCT,
      });

    it('two overlapping runners email a due report once', async () => {
      const rowsFor = jest.fn().mockResolvedValue([{ label: 'Depot A', orders: 2, revenue: 5000 }]);
      const a = makeRunner(rowsFor);
      await create(a.schedules);
      // A second runner over the SAME schedule store, with its own mailer.
      const mailerB = { send: jest.fn().mockResolvedValue(true) };
      const runnerB = new ScheduledReportRunnerService(
        a.schedules,
        a.logs,
        {
          rowsFor,
          tableFor: async (d: ReportDataset, f: Date, t: Date) => revenueTable(await rowsFor(d, f, t)),
        } as never,
        mailerB,
      );

      // Both read the due list before either claims: the interleaving that duplicated mail.
      const dueA = await a.schedules.findDue(WED, 10);
      const real = a.schedules.findDue.bind(a.schedules);
      jest.spyOn(a.schedules, 'findDue').mockImplementation(async () => dueA.map((r) => ({ ...r })));
      const [resA, resB] = await Promise.all([a.runner.runDue(WED), runnerB.runDue(WED)]);
      jest.restoreAllMocks();
      void real;

      expect(a.mailer.send.mock.calls.length + mailerB.send.mock.calls.length).toBe(1);
      expect(resA.produced + resB.produced).toBe(1);
      expect(a.logs.rows).toHaveLength(1);
    });

    it('a schedule that was claimed but never finished comes due again after the lease', async () => {
      const rowsFor = jest.fn().mockResolvedValue([{ label: 'Depot A', orders: 2, revenue: 5000 }]);
      const { schedules, runner } = makeRunner(rowsFor);
      const sched = await create(schedules);
      // A runner claimed it and died: nothing stamped except the lease.
      await schedules.claimRun(sched.id, sched.nextRunAt, new Date(WED.getTime() + 15 * 60_000));

      expect((await runner.runDue(WED)).due).toBe(0); // inside the lease: left alone
      const later = new Date(WED.getTime() + 16 * 60_000);
      expect(await runner.runDue(later)).toMatchObject({ due: 1, produced: 1 }); // lease expired
    });

    it('does not claim a disabled or already-moved schedule', async () => {
      const { schedules } = makeRunner(jest.fn());
      const sched = await create(schedules);
      const lease = new Date(WED.getTime() + 15 * 60_000);

      expect(await schedules.claimRun(sched.id, sched.nextRunAt, lease)).toBe(true);
      // The same read can no longer claim it: nextRunAt has moved to the lease.
      expect(await schedules.claimRun(sched.id, sched.nextRunAt, lease)).toBe(false);
      expect(await schedules.claimRun('missing', null, lease)).toBe(false);
    });
  });

  it('produces a file, logs it DONE, and stamps the next run', async () => {
    const rowsFor = jest.fn().mockResolvedValue([{ label: 'Depot A', orders: 2, revenue: 5000 }]);
    const { schedules, logs, runner } = makeRunner(rowsFor);
    await schedules.create({
      name: 'Harian',
      cadence: ReportCadence.DAILY,
      recipients: ['finance@hydromart.id'],
      format: ExportFormat.CSV,
      dataset: ReportDataset.REVENUE_BY_PRODUCT,
    });

    expect(await runner.runDue(WED)).toEqual({ due: 1, produced: 1, failed: 0, ok: true });

    expect(rowsFor).toHaveBeenCalledWith(
      ReportDataset.REVENUE_BY_PRODUCT,
      new Date('2026-08-10T17:00:00.000Z'), // Tue 11 Aug 00:00 WIB
      new Date('2026-08-11T17:00:00.000Z'), // Wed 12 Aug 00:00 WIB
    );
    const [log] = logs.rows;
    expect(log).toMatchObject({ status: ExportStatus.DONE, rowCount: 1, hasFile: true });
    expect(await logs.findContent(log.id)).not.toBeNull();

    const [after] = await schedules.list();
    expect(after.lastRunAt).toEqual(WED);
    expect(after.nextRunAt).toEqual(new Date('2026-08-12T17:00:00.000Z')); // Thu 13 Aug 00:00 WIB
    // CA-2-66: and the outcome, beside the timestamp.
    expect(after.lastRunOk).toBe(true);
    expect(after.lastError).toBeNull();
  });

  /*
   * The failure that matters. An unreachable service must not produce an EMPTY report: a
   * revenue file with no rows reads as a quiet month, not as an outage.
   */
  it('records a FAILED log instead of an empty report when the source is down', async () => {
    const rowsFor = jest.fn().mockRejectedValue(new Error('order-service responded 503'));
    const { schedules, logs, runner } = makeRunner(rowsFor);
    await schedules.create({
      name: 'Harian',
      cadence: ReportCadence.DAILY,
      recipients: ['finance@hydromart.id'],
    });

    expect(await runner.runDue(WED)).toEqual({ due: 1, produced: 1 - 1, failed: 1, ok: false });
    expect(logs.rows[0]).toMatchObject({
      status: ExportStatus.FAILED,
      rowCount: null,
      hasFile: false,
    });
  });

  it('emails the generated file to the recipients as an attachment', async () => {
    const { schedules, runner, mailer } = makeRunner(jest.fn().mockResolvedValue([{ a: 1 }]));
    await schedules.create({
      name: 'Harian',
      cadence: ReportCadence.DAILY,
      recipients: ['a@b.c', 'd@e.f'],
      format: ExportFormat.CSV,
    });
    await runner.runDue(WED);
    expect(mailer.send).toHaveBeenCalledWith({
      to: ['a@b.c', 'd@e.f'],
      subject: 'Harian',
      fileName: 'harian-2026-08-11.csv',
      content: expect.any(Buffer),
    });
  });

  it('does not email when there are no recipients, or when the report failed', async () => {
    const ok = makeRunner(jest.fn().mockResolvedValue([]));
    await ok.schedules.create({ name: 'K', cadence: ReportCadence.DAILY, recipients: [] });
    await ok.runner.runDue(WED);
    expect(ok.mailer.send).not.toHaveBeenCalled();

    const bad = makeRunner(jest.fn().mockRejectedValue(new Error('down')));
    await bad.schedules.create({ name: 'K', cadence: ReportCadence.DAILY, recipients: ['a@b.c'] });
    await bad.runner.runDue(WED);
    expect(bad.mailer.send).not.toHaveBeenCalled();
  });

  it('still counts the run produced when the mailer reports it could not send', async () => {
    const { schedules, runner, mailer } = makeRunner(jest.fn().mockResolvedValue([]));
    mailer.send.mockResolvedValue(false);
    await schedules.create({ name: 'K', cadence: ReportCadence.DAILY, recipients: ['a@b.c'] });
    expect(await runner.runDue(WED)).toEqual({ due: 1, produced: 1, failed: 0, ok: true });
  });

  // A schedule that fails every tick must not become a hot loop refiring every minute.
  it('advances nextRunAt even when the run failed', async () => {
    const { schedules, runner } = makeRunner(jest.fn().mockRejectedValue(new Error('down')));
    await schedules.create({
      name: 'Harian',
      cadence: ReportCadence.DAILY,
      recipients: ['ops@hydromart.id'],
    });
    await runner.runDue(WED);
    const [after] = await schedules.list();
    expect(after.nextRunAt).toEqual(new Date('2026-08-12T17:00:00.000Z')); // Thu 13 Aug 00:00 WIB
  });

  /*
   * CA-2-66: and it must SAY so.
   *
   * Advancing `lastRunAt` on a failure is right — it is what stops the hot loop — and it
   * is also what made a broken schedule indistinguishable from a working one. Head office
   * set up a weekly revenue report, saw a fresh timestamp every Monday, and had no way to
   * learn the file had not been produced for a month. The runner has always known which it
   * was; there was nowhere on the schedule to write the answer down.
   */
  it('records that the run failed, and why, beside the timestamp', async () => {
    const { schedules, runner } = makeRunner(
      jest.fn().mockRejectedValue(new Error('order-service responded 503')),
    );
    await schedules.create({
      name: 'Mingguan',
      cadence: ReportCadence.DAILY,
      recipients: ['finance@hydromart.id'],
    });

    await runner.runDue(WED);

    const [after] = await schedules.list();
    expect(after.lastRunAt).toEqual(WED);
    expect(after.lastRunOk).toBe(false);
    expect(after.lastError).toBe('order-service responded 503');
  });

  it('clears a previous failure once the report works again', async () => {
    const rowsFor = jest
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue([{ a: 1 }]);
    const { schedules, runner } = makeRunner(rowsFor);
    await schedules.create({
      name: 'Harian',
      cadence: ReportCadence.DAILY,
      recipients: ['ops@hydromart.id'],
    });

    await runner.runDue(WED);
    expect((await schedules.list())[0].lastRunOk).toBe(false);

    // A stale error beside a run that worked is its own lie.
    await runner.runDue(new Date('2026-08-13T00:00:00.000Z'));
    const [after] = await schedules.list();
    expect(after.lastRunOk).toBe(true);
    expect(after.lastError).toBeNull();
  });

  it('skips a disabled schedule and one that is not due yet', async () => {
    const { schedules, runner } = makeRunner(jest.fn().mockResolvedValue([]));
    await schedules.create({
      name: 'Mati',
      cadence: ReportCadence.DAILY,
      recipients: ['a@b.c'],
      enabled: false,
    });
    await schedules.create({
      name: 'Besok',
      cadence: ReportCadence.DAILY,
      recipients: ['a@b.c'],
      nextRunAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    expect(await runner.runDue(WED)).toEqual({ due: 0, produced: 0, failed: 0, ok: true });
  });

  // A schedule created before the executor existed was never stamped. Reading NULL as
  // "not due yet" would leave it waiting forever.
  it('treats a never-stamped schedule as due', async () => {
    const { schedules, runner } = makeRunner(jest.fn().mockResolvedValue([]));
    await schedules.create({ name: 'Lama', cadence: ReportCadence.DAILY, recipients: ['a@b.c'] });
    expect((await runner.runDue(WED)).due).toBe(1);
  });

  it.each([
    ['a produced report', jest.fn().mockResolvedValue([])],
    ['a failed one', jest.fn().mockRejectedValue(new Error('down'))],
  ])('falls back to a scheduler label on %s with no recipients', async (_case, rowsFor) => {
    const { schedules, logs, runner } = makeRunner(rowsFor);
    await schedules.create({ name: 'Kosong', cadence: ReportCadence.DAILY, recipients: [] });
    await runner.runDue(WED);
    expect(logs.rows[0].requestedByEmail).toBe('scheduler');
  });

  // The DTO renders both stamps, and a schedule that has never run has neither.
  it('reports lastRunAt only once a run has happened', async () => {
    const { schedules, runner } = makeRunner(jest.fn().mockResolvedValue([]));
    const created = await schedules.create({
      name: 'Baru',
      cadence: ReportCadence.DAILY,
      recipients: ['a@b.c'],
    });
    expect(created.lastRunAt).toBeNull();
    await runner.runDue(WED);
    expect((await schedules.list())[0].lastRunAt).toEqual(WED);
  });
  /*
   * The cron entry calls `runDue()` with no argument, so the default `new Date()` is the
   * arm the SWEEP actually takes and every test above passes an explicit date. CI counts
   * that default as an uncovered branch — and it is the one path production runs.
   */
  it('sweeps against the current clock when called with no argument', async () => {
    const { schedules, logs, runner } = makeRunner(jest.fn().mockResolvedValue([]));
    await schedules.create({
      name: 'Tanpa jam',
      cadence: ReportCadence.DAILY,
      recipients: ['a@b.c'],
      format: ExportFormat.CSV,
      dataset: ReportDataset.REVENUE_BY_PRODUCT,
    });
    const result = await runner.runDue();
    expect(result.due).toBe(1);
    expect(logs.rows).toHaveLength(1);
  });
});
