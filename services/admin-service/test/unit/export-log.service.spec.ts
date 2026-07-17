import { ExportFormat, ExportStatus } from '../../src/domain/export';
import { ExportLogService } from '../../src/application/services/export-log.service';
import { InMemoryExportLogRepository, makeExportLog } from '../support/fakes';

describe('ExportLogService', () => {
  let repo: InMemoryExportLogRepository;
  let service: ExportLogService;

  beforeEach(() => {
    repo = new InMemoryExportLogRepository();
    service = new ExportLogService(repo);
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
});
