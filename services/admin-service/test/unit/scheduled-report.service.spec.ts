import { ScheduledReportNotFoundError } from '../../src/domain/errors';
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
});
