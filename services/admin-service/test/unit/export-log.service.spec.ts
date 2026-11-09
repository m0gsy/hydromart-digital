import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { ExportLogService } from '../../src/application/services/export-log.service';
import { InMemoryExportLogRepository, makeExportLog } from '../support/fakes';

describe('ExportLogService', () => {
  let repo: InMemoryExportLogRepository;
  let service: ExportLogService;
  let audit: { record: jest.Mock };

  beforeEach(() => {
    repo = new InMemoryExportLogRepository();
    audit = { record: jest.fn(async () => undefined) };
    service = new ExportLogService(repo, audit as never);
  });

  // AAS-16: a GET is not audited by the mutation interceptor, so a downloaded export - the data that
  // left the building - left no trace. Each download now names who took which file.
  it('records who downloaded which export', async () => {
    const row = makeExportLog({ dataset: 'Pendapatan' });
    repo.rows = [row];
    jest.spyOn(repo, 'findContent').mockResolvedValue({ fileName: 'a.csv', content: Buffer.from('x') });
    const out = await service.download(row.id, 'u-9');
    expect(out?.fileName).toBe('a.csv');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'export.download', actorId: 'u-9', target: row.id }),
    );
  });

  it('records nothing when there is no file, and still serves when no audit sink is wired', async () => {
    jest.spyOn(repo, 'findContent').mockResolvedValueOnce(null);
    expect(await service.download('nope', 'u-9')).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
    jest.spyOn(repo, 'findContent').mockResolvedValueOnce({ fileName: 'a.csv', content: Buffer.from('x') });
    const bare = new ExportLogService(repo);
    expect((await bare.download('x', 'u-9'))?.fileName).toBe('a.csv');
  });

  it('ingests an export run', async () => {
    const rec = await service.ingest({
      dataset: 'Revenue',
      requestedByEmail: 'finance@hydromart.id',
      format: ExportFormat.CSV,
      rowCount: 42,
      status: ExportStatus.DONE,
    });
    expect(rec.dataset).toBe('Revenue');
    expect(rec.status).toBe(ExportStatus.DONE);
  });

  it('lists newest-first and paginates', async () => {
    repo.rows = [
      makeExportLog({ dataset: 'A', createdAt: new Date(1000) }),
      makeExportLog({ dataset: 'B', createdAt: new Date(3000) }),
      makeExportLog({ dataset: 'C', createdAt: new Date(2000) }),
    ];
    const page = await service.list({ page: 1, limit: 2 });
    expect(page.total).toBe(3);
    expect(page.items.map((r) => r.dataset)).toEqual(['B', 'C']); // newest first
  });

  it('filters by dataset and status', async () => {
    repo.rows = [
      makeExportLog({ dataset: 'A', status: ExportStatus.DONE }),
      makeExportLog({ dataset: 'A', status: ExportStatus.FAILED }),
      makeExportLog({ dataset: 'B', status: ExportStatus.DONE }),
    ];
    const byDataset = await service.list({ page: 1, limit: 20, dataset: 'A' });
    expect(byDataset.total).toBe(2);
    const byStatus = await service.list({ page: 1, limit: 20, status: ExportStatus.FAILED });
    expect(byStatus.total).toBe(1);
  });

  /*
   * A separate read from `list` on purpose: shipping every stored file's bytes inside a
   * page of the table would turn a screen into a download of everything at once.
   */
  it('download returns the stored file, and null when the row has none', async () => {
    const repo = new InMemoryExportLogRepository();
    const service = new ExportLogService(repo);
    const withFile = await repo.create({
      dataset: 'REVENUE_BY_DEPOT',
      requestedByEmail: 'scheduler',
      format: ExportFormat.CSV,
      content: Buffer.from('hi'),
      fileName: 'a.csv',
    });
    const withoutFile = await repo.create({
      dataset: 'REVENUE_BY_DEPOT',
      requestedByEmail: 'scheduler',
      format: ExportFormat.CSV,
    });

    await expect(service.download(withFile.id, 'u-1')).resolves.toEqual({
      fileName: 'a.csv',
      content: Buffer.from('hi'),
    });
    expect(await service.download(withoutFile.id, 'u-1')).toBeNull();
  });
});
