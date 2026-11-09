import { PolicyChangeService } from '../../src/application/services/policy-change.service';
import {
  IdleLimitOutOfRangeError,
  PolicyChangeNotFoundError,
  PolicyChangeNotPendingError,
  PolicyChangeSelfDecideError,
  RetentionPolicyInvalidError,
} from '../../src/domain/errors';
import { InMemoryPolicyChangeRepository } from '../support/fakes';

/*
 * AAS-14 (owner decision 2026-11-09). A security-policy or retention change is a REQUEST until a
 * second super admin approves it. The requester can neither approve nor reject their own.
 */
describe('PolicyChangeService (AAS-14)', () => {
  const ALICE = 'super-alice';
  const BOB = 'super-bob';
  const SECURITY = { idleTimeoutMinutes: 60, require2fa: true, ipAllowlist: ['10.0.0.0/8'] };

  let repo: InMemoryPolicyChangeRepository;
  let security: { validate: jest.Mock; save: jest.Mock };
  let retention: { validate: jest.Mock; updatePolicy: jest.Mock };
  let service: PolicyChangeService;

  beforeEach(() => {
    repo = new InMemoryPolicyChangeRepository();
    security = { validate: jest.fn(), save: jest.fn().mockResolvedValue({}) };
    retention = { validate: jest.fn().mockResolvedValue({}), updatePolicy: jest.fn().mockResolvedValue({}) };
    service = new PolicyChangeService(repo as never, security as never, retention as never);
  });

  it('a request validates, records, and applies NOTHING', async () => {
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    expect(req).toMatchObject({ status: 'PENDING', kind: 'SECURITY_POLICY', requestedBy: ALICE });
    expect(security.validate).toHaveBeenCalledWith(SECURITY);
    expect(security.save).not.toHaveBeenCalled();
  });

  it('an illegal value is refused to the requester, and nothing is queued', async () => {
    security.validate.mockImplementation(() => {
      throw new IdleLimitOutOfRangeError(30, 1440);
    });
    await expect(service.requestSecurityChange({ ...SECURITY, idleTimeoutMinutes: 5 }, ALICE)).rejects.toBeInstanceOf(
      IdleLimitOutOfRangeError,
    );
    retention.validate.mockRejectedValue(new RetentionPolicyInvalidError('di bawah 10 tahun'));
    await expect(service.requestRetentionChange('r-1', { windowLabel: 'x', windowDays: 30 }, ALICE)).rejects.toBeInstanceOf(
      RetentionPolicyInvalidError,
    );
    expect(repo.rows).toHaveLength(0);
  });

  it('another super admin approving applies the stored payload through the normal call', async () => {
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    const out = await service.approve(req.id, BOB, 'oke');
    expect(out).toMatchObject({ status: 'APPLIED', decidedBy: BOB, decisionNote: 'oke' });
    expect(security.save).toHaveBeenCalledWith(SECURITY);
  });

  it('applies a retention change to its own dataset', async () => {
    const req = await service.requestRetentionChange('r-7', { windowLabel: '5 tahun', windowDays: 1825 }, ALICE);
    await service.approve(req.id, BOB, null);
    expect(retention.updatePolicy).toHaveBeenCalledWith('r-7', { windowLabel: '5 tahun', windowDays: 1825 });
  });

  it('the requester can neither approve nor reject their own request', async () => {
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    await expect(service.approve(req.id, ALICE, null)).rejects.toBeInstanceOf(PolicyChangeSelfDecideError);
    await expect(service.reject(req.id, ALICE, null)).rejects.toBeInstanceOf(PolicyChangeSelfDecideError);
    expect(security.save).not.toHaveBeenCalled();
    expect((await repo.findById(req.id))?.status).toBe('PENDING');
  });

  it('a rejection applies nothing and is final', async () => {
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    expect(await service.reject(req.id, BOB, 'tidak')).toMatchObject({ status: 'REJECTED' });
    expect(security.save).not.toHaveBeenCalled();
    await expect(service.approve(req.id, BOB, null)).rejects.toBeInstanceOf(PolicyChangeNotPendingError);
  });

  it('an unknown id is a 404, and a decided one cannot be decided again', async () => {
    await expect(service.approve('nope', BOB, null)).rejects.toBeInstanceOf(PolicyChangeNotFoundError);
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    await service.approve(req.id, BOB, null);
    await expect(service.approve(req.id, 'super-carol', null)).rejects.toBeInstanceOf(PolicyChangeNotPendingError);
    expect(security.save).toHaveBeenCalledTimes(1);
  });

  it('two approvers racing: only the one that wins the claim applies it', async () => {
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    // Both pass the read; the second claim finds the row no longer PENDING.
    const realFind = repo.findById.bind(repo);
    jest.spyOn(repo, 'findById').mockImplementation(async (id: string) => {
      const row = await realFind(id);
      return row ? { ...row, status: 'PENDING' as const } : null;
    });
    const results = await Promise.allSettled([
      service.approve(req.id, BOB, null),
      service.approve(req.id, 'super-carol', null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(security.save).toHaveBeenCalledTimes(1);
  });

  it('a failed apply hands the request back to PENDING and surfaces the error', async () => {
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    security.save.mockRejectedValue(new Error('db down'));
    await expect(service.approve(req.id, BOB, null)).rejects.toThrow('db down');
    expect((await repo.findById(req.id))?.status).toBe('PENDING');
    security.save.mockResolvedValue({});
    expect(await service.approve(req.id, BOB, null)).toMatchObject({ status: 'APPLIED' });
  });

  it('a failed reopen after a failed apply is logged, and the apply error still surfaces', async () => {
    const req = await service.requestSecurityChange(SECURITY, ALICE);
    security.save.mockRejectedValue(new Error('db down'));
    jest.spyOn(repo, 'reopen').mockRejectedValue(new Error('also down'));
    await expect(service.approve(req.id, BOB, null)).rejects.toThrow('db down');
  });

  it('lists newest requests, optionally by status', async () => {
    const a = await service.requestSecurityChange(SECURITY, ALICE);
    await service.requestSecurityChange(SECURITY, ALICE);
    await service.reject(a.id, BOB, null);
    expect(await service.list()).toHaveLength(2);
    expect(await service.list('PENDING')).toHaveLength(1);
  });
});
