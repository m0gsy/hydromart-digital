import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { ReportCadence } from '../../src/domain/report-cadence';
import { ReportDataset } from '../../src/domain/report-dataset';
import { nextRunAfter, reportWindow } from '../../src/domain/report-window';
import { renderReport, reportFileName } from '../../src/domain/report-file';
import { ScheduledReportRunnerService } from '../../src/application/services/scheduled-report-runner.service';
import {
  InMemoryExportLogRepository,
  InMemoryScheduledReportRepository,
} from '../support/fakes';

/*
 * The executor that did not exist. `hq/scheduled-reports` had full CRUD, `nextRunAt` was
 * documented as "advisory metadata for the future scheduler", and nothing ever produced a
 * file — which is also why `hq/exports` was permanently empty: nothing wrote a log either.
 */

const WED = new Date('2026-08-12T03:00:00.000Z'); // a Wednesday

function makeRunner(rowsFor: jest.Mock) {
  const schedules = new InMemoryScheduledReportRepository();
  const logs = new InMemoryExportLogRepository();
  const runner = new ScheduledReportRunnerService(schedules, logs, { rowsFor } as never);
  return { schedules, logs, runner };
}

describe('reportWindow', () => {
  /*
   * A report must describe a period that has FINISHED. Reporting on the period it is
   * running inside would produce a file whose numbers change every time it is generated,
   * which is the one thing a scheduled report cannot do.
   */
  it('reports yesterday for DAILY, not the partial day it runs in', () => {
    expect(reportWindow(ReportCadence.DAILY, WED)).toEqual({
      from: new Date('2026-08-11T00:00:00.000Z'),
      to: new Date('2026-08-12T00:00:00.000Z'),
    });
  });

  it('reports last Monday-to-Monday for WEEKLY', () => {
    expect(reportWindow(ReportCadence.WEEKLY, WED)).toEqual({
      from: new Date('2026-08-03T00:00:00.000Z'),
      to: new Date('2026-08-10T00:00:00.000Z'),
    });
  });

  // Sunday is getUTCDay() 0, so a naive "days since Monday" would call it day zero and
  // report the week that has not finished.
  it('treats Sunday as the END of a week, not the start', () => {
    const sunday = new Date('2026-08-09T03:00:00.000Z');
    expect(reportWindow(ReportCadence.WEEKLY, sunday)).toEqual({
      from: new Date('2026-07-27T00:00:00.000Z'),
      to: new Date('2026-08-03T00:00:00.000Z'),
    });
  });

  it('reports last calendar month for MONTHLY', () => {
    expect(reportWindow(ReportCadence.MONTHLY, WED)).toEqual({
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('rolls a December monthly window into the previous year', () => {
    const jan = new Date('2026-01-05T03:00:00.000Z');
    expect(reportWindow(ReportCadence.MONTHLY, jan).from).toEqual(
      new Date('2025-12-01T00:00:00.000Z'),
    );
  });
});

describe('nextRunAfter', () => {
  it.each([
    [ReportCadence.DAILY, '2026-08-13T00:00:00.000Z'],
    [ReportCadence.WEEKLY, '2026-08-17T00:00:00.000Z'],
    [ReportCadence.MONTHLY, '2026-09-01T00:00:00.000Z'],
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

  // A depot called `Depot "Baru", Cibubur` must stay one column.
  it('quotes a label containing a comma or a quote', async () => {
    const text = (
      await renderReport([{ label: 'Depot "Baru", Cibubur', orders: 1, revenue: 1 }], ExportFormat.CSV, 'x')
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

  /*
   * There is no PDF renderer anywhere in this repo. Handing back an .xlsx under a .pdf
   * name is exactly how a format option survives for years without anyone noticing it
   * never worked, so the format is refused instead.
   */
  it('refuses PDF rather than silently handing back another format', async () => {
    await expect(renderReport(rows, ExportFormat.PDF, 'x')).rejects.toThrow(/PDF/);
  });

  it('names the file after the window, not the run time', () => {
    expect(reportFileName('Laporan Harian!', new Date('2026-08-11T00:00:00.000Z'), ExportFormat.CSV))
      .toBe('laporan-harian-2026-08-11.csv');
  });

  it('falls back to a usable name when the title has no letters at all', () => {
    expect(reportFileName('!!!', new Date('2026-08-11T00:00:00.000Z'), ExportFormat.XLSX))
      .toBe('laporan-2026-08-11.xlsx');
  });
});

describe('ScheduledReportRunnerService', () => {
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

    expect(await runner.runDue(WED)).toEqual({ due: 1, produced: 1, failed: 0 });

    expect(rowsFor).toHaveBeenCalledWith(
      ReportDataset.REVENUE_BY_PRODUCT,
      new Date('2026-08-11T00:00:00.000Z'),
      new Date('2026-08-12T00:00:00.000Z'),
    );
    const [log] = logs.rows;
    expect(log).toMatchObject({ status: ExportStatus.DONE, rowCount: 1, hasFile: true });
    expect(await logs.findContent(log.id)).not.toBeNull();

    const [after] = await schedules.list();
    expect(after.lastRunAt).toEqual(WED);
    expect(after.nextRunAt).toEqual(new Date('2026-08-13T00:00:00.000Z'));
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

    expect(await runner.runDue(WED)).toEqual({ due: 1, produced: 1 - 1, failed: 1 });
    expect(logs.rows[0]).toMatchObject({ status: ExportStatus.FAILED, rowCount: null, hasFile: false });
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
    expect(after.nextRunAt).toEqual(new Date('2026-08-13T00:00:00.000Z'));
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
    expect(await runner.runDue(WED)).toEqual({ due: 0, produced: 0, failed: 0 });
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
});
