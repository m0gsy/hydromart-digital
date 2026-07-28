import { RetentionPolicyInvalidError, RetentionPolicyNotFoundError } from '../../src/domain/errors';
import { DataClass } from '../../src/domain/retention';
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
    repo.rows = [
      makeRetentionPolicy({ dataset: 'audit_logs' }),
      makeRetentionPolicy({ dataset: 'orders' }),
    ];
    const list = await service.listPolicies();
    expect(list.map((r) => r.dataset)).toEqual(['audit_logs', 'orders']);
  });

  it('updates a policy window', async () => {
    const row = makeRetentionPolicy({ dataset: 'audit_logs', windowDays: 730 });
    repo.rows = [row];
    const updated = await service.updatePolicy(row.id, {
      windowLabel: '3 tahun',
      windowDays: 1095,
    });
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

  describe('data classes (M23-21)', () => {
    it('refuses to shorten financial retention below ten years', async () => {
      const row = makeRetentionPolicy({
        dataset: 'orders_transactions',
        dataClass: DataClass.FINANCIAL,
        windowDays: 3650,
      });
      repo.rows = [row];

      await expect(
        service.updatePolicy(row.id, { windowLabel: '1 tahun', windowDays: 365 }),
      ).rejects.toBeInstanceOf(RetentionPolicyInvalidError);
      // Nothing was written.
      expect((await repo.findPolicy(row.id))!.windowDays).toBe(3650);
    });

    it('allows lengthening a financial window', async () => {
      const row = makeRetentionPolicy({ dataClass: DataClass.FINANCIAL, windowDays: 3650 });
      repo.rows = [row];
      const out = await service.updatePolicy(row.id, { windowLabel: '20 tahun', windowDays: 7300 });
      expect(out.windowDays).toBe(7300);
    });

    it('applies the floor to a class CHANGE, not just to the stored class', async () => {
      const row = makeRetentionPolicy({ dataClass: DataClass.MARKETING, windowDays: 90 });
      repo.rows = [row];
      await expect(
        service.updatePolicy(row.id, {
          windowLabel: '90 hari',
          windowDays: 90,
          dataClass: DataClass.FINANCIAL,
        }),
      ).rejects.toBeInstanceOf(RetentionPolicyInvalidError);
    });

    it('reports no purge cutoff for financial data and a real one for the rest', async () => {
      repo.rows = [
        makeRetentionPolicy({
          dataset: 'orders_transactions',
          dataClass: DataClass.FINANCIAL,
          windowDays: 3650,
        }),
        makeRetentionPolicy({
          dataset: 'notifications_messages',
          dataClass: DataClass.MARKETING,
          windowDays: 90,
        }),
      ];
      const now = new Date('2026-07-28T00:00:00.000Z');
      const plan = await service.purgeCutoffs(now);

      const financial = plan.find((p) => p.dataset === 'orders_transactions')!;
      expect(financial).toMatchObject({ purgeExempt: true, cutoff: null });

      const marketing = plan.find((p) => p.dataset === 'notifications_messages')!;
      expect(marketing.purgeExempt).toBe(false);
      expect(marketing.cutoff).toEqual(new Date('2026-04-29T00:00:00.000Z'));
    });
  });
});
