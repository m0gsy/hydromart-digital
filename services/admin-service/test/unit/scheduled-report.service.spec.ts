import { ScheduledReportNotFoundError } from '../../src/domain/errors';
import { ScheduledReportDto } from '../../src/modules/dto/scheduled-report.dto';
import { ReportCadence } from '../../src/domain/report-cadence';
import { ScheduledReportService } from '../../src/application/services/scheduled-report.service';
import { InMemoryScheduledReportRepository } from '../support/fakes';

describe('ScheduledReportService', () => {
  let repo: InMemoryScheduledReportRepository;
  let service: ScheduledReportService;

  beforeEach(() => {
    repo = new InMemoryScheduledReportRepository();
    service = new ScheduledReportService(repo);
  });

  it('creates a schedule (defaults enabled)', async () => {
    const r = await service.create({
      name: 'Daily revenue',
      cadence: ReportCadence.DAILY,
      recipients: ['finance@hydromart.id'],
    });
    expect(r.enabled).toBe(true);
    expect(r.cadence).toBe(ReportCadence.DAILY);
  });

  it('disables a schedule via update', async () => {
    const r = await service.create({
      name: 'Daily revenue',
      cadence: ReportCadence.DAILY,
      recipients: ['finance@hydromart.id'],
    });
    const off = await service.update(r.id, { enabled: false });
    expect(off.enabled).toBe(false);
  });

  it('deletes a schedule', async () => {
    const r = await service.create({
      name: 'Daily revenue',
      cadence: ReportCadence.DAILY,
      recipients: ['finance@hydromart.id'],
    });
    await service.remove(r.id);
    expect(await service.list()).toHaveLength(0);
  });

  it('throws ScheduledReportNotFoundError for unknown ids', async () => {
    await expect(service.update('nope', { enabled: false })).rejects.toBeInstanceOf(
      ScheduledReportNotFoundError,
    );
    await expect(service.remove('nope')).rejects.toBeInstanceOf(ScheduledReportNotFoundError);
  });
  /*
   * Both stamps are nullable and the DTO renders each one either way. Only the null arm was
   * ever exercised — a schedule that HAS run is the state the HQ table spends its life in,
   * and it was the branch CI counted as missing.
   */
  it('renders both run stamps as ISO strings once they exist', () => {
    const ran = new Date('2026-08-12T17:00:00.000Z');
    const next = new Date('2026-08-13T17:00:00.000Z');
    const dto = ScheduledReportDto.from({
      id: 'r-1',
      name: 'Harian',
      cadence: ReportCadence.DAILY,
      recipients: [],
      format: 'CSV',
      dataset: 'REVENUE_BY_PRODUCT',
      nextRunAt: next,
      lastRunAt: ran,
      enabled: true,
      createdAt: ran,
    } as never);
    expect(dto.nextRunAt).toBe(next.toISOString());
    expect(dto.lastRunAt).toBe(ran.toISOString());
  });
});
