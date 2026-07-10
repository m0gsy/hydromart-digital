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
});
