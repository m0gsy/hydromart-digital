import { RetentionPolicyNotFoundError } from '../../src/domain/errors';
import { RetentionService } from '../../src/application/services/retention.service';
import { InMemoryRetentionRepository, makeRetentionPolicy } from '../support/fakes';

describe('RetentionService', () => {
  let repo: InMemoryRetentionRepository;
  let service: RetentionService;

  beforeEach(() => {
    repo = new InMemoryRetentionRepository();
    service = new RetentionService(repo);
  });

  it('lists retention policies', async () => {
    repo.rows = [makeRetentionPolicy({ dataset: 'audit_logs' }), makeRetentionPolicy({ dataset: 'orders' })];
    const list = await service.listPolicies();
    expect(list.map((r) => r.dataset)).toEqual(['audit_logs', 'orders']);
  });

  it('updates a policy window', async () => {
    const row = makeRetentionPolicy({ dataset: 'audit_logs', windowDays: 730 });
    repo.rows = [row];
    const updated = await service.updatePolicy(row.id, { windowLabel: '3 tahun', windowDays: 1095 });
    expect(updated).toMatchObject({ windowLabel: '3 tahun', windowDays: 1095 });
  });

  it('throws RetentionPolicyNotFoundError for unknown ids', async () => {
    await expect(
      service.updatePolicy('nope', { windowLabel: 'x', windowDays: 1 }),
    ).rejects.toBeInstanceOf(RetentionPolicyNotFoundError);
  });

  it('returns an honest NONE backup status when nothing recorded', async () => {
    const backup = await service.getBackupStatus();
    expect(backup).toEqual({ status: 'NONE', lastBackupAt: null });
  });
});
