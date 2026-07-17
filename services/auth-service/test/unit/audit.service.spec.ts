import { AuditAction, AuditService } from '../../src/application/services/audit.service';
import { InMemoryAuditLogRepository } from '../support/fakes';

describe('AuditService', () => {
  it('records an audit entry', async () => {
    const repo = new InMemoryAuditLogRepository();
    const service = new AuditService(repo);

    await service.record({
      customerId: 'cust-1',
      action: AuditAction.LOGIN_SUCCEEDED,
      success: true,
      ipAddress: null,
      userAgent: null,
    });

    expect(repo.entries).toHaveLength(1);
  });

  it('never lets an audit failure break the caller', async () => {
    const repo = new InMemoryAuditLogRepository();
    repo.shouldFail = true;
    const service = new AuditService(repo);

    await expect(
      service.record({
        customerId: 'cust-1',
        action: AuditAction.LOGOUT,
        success: true,
        ipAddress: null,
        userAgent: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('ingests a cross-service event and folds target into metadata', async () => {
    const repo = new InMemoryAuditLogRepository();
    const service = new AuditService(repo);

    await service.ingest({
      actorId: 'staff-1',
      action: 'depot.suspend',
      target: 'Depot Kelapa Gading',
      metadata: { reason: 'audit' },
    });

    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0]).toMatchObject({
      customerId: 'staff-1',
      action: 'depot.suspend',
      success: true,
      metadata: { reason: 'audit', target: 'Depot Kelapa Gading' },
    });
  });

  it('lists entries newest-first, paginated, filtered by action', async () => {
    const repo = new InMemoryAuditLogRepository();
    const service = new AuditService(repo);
    await service.record({ customerId: 'a', action: 'x', success: true, ipAddress: null, userAgent: null });
    await service.record({ customerId: 'b', action: 'depot.suspend', success: true, ipAddress: null, userAgent: null });
    await service.record({ customerId: 'c', action: 'depot.suspend', success: false, ipAddress: null, userAgent: null });

    const all = await service.list({ page: 1, limit: 10 });
    expect(all.total).toBe(3);
    // Newest first: the last-recorded entry leads.
    expect(all.items[0].customerId).toBe('c');

    const filtered = await service.list({ page: 1, limit: 10, action: 'depot.suspend' });
    expect(filtered.total).toBe(2);
    expect(filtered.items.every((i) => i.action === 'depot.suspend')).toBe(true);
  });
});
