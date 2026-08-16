import {
  AUDIT_CATEGORIES,
  AuditAction,
  AuditService,
} from '../../src/application/services/audit.service';
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

  it('scopes a depot audit list by depotId and category (design 8b)', async () => {
    const repo = new InMemoryAuditLogRepository();
    const service = new AuditService(repo);
    // Real action strings, not invented ones: the categories are only worth anything if
    // they match what the three writing services actually record.
    await service.ingest({
      actorId: 'a',
      action: 'payment.refund.settled',
      metadata: { depotId: 'd1' },
    });
    await service.ingest({
      actorId: 'b',
      action: 'depot.price_override.approved',
      metadata: { depotId: 'd1' },
    });
    await service.ingest({
      actorId: 'c',
      action: 'payment.refund.settled',
      metadata: { depotId: 'd2' },
    });

    const d1 = await service.list({ page: 1, limit: 10, depotId: 'd1' });
    expect(d1.total).toBe(2);

    const refunds = await service.list({ page: 1, limit: 10, depotId: 'd1', type: 'REFUND' });
    expect(refunds.total).toBe(1);
    expect(refunds.items[0].action).toBe('payment.refund.settled');

    const harga = await service.list({ page: 1, limit: 10, depotId: 'd1', type: 'HARGA' });
    expect(harga.total).toBe(1);
    expect(harga.items[0].action).toBe('depot.price_override.approved');
  });
});

describe('AuditService.purgeOlderThan (retention enforcement)', () => {
  it('passes the cutoff straight to the repository and reports the count', async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.record({ customerId: null, action: 'a', success: true, ipAddress: null, userAgent: null });
    const service = new AuditService(repo);

    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    expect(await service.purgeOlderThan(cutoff)).toEqual({ deleted: 1 });
    expect(repo.purgedBefore).toEqual(cutoff);
  });
});

/*
 * Audit: the depot audit view offered five category chips and three of them could not match
 * anything — OPNAME, RECEIPT and SETORAN named activity that nothing writes to this trail.
 * A filter that always comes back empty reads as "no such activity", which is a different
 * claim from "not recorded here", and it is the more reassuring one.
 *
 * This pins the categories to what is actually recorded. The list below is maintained by
 * hand because the actions come from three services; adding a category whose words match
 * none of them fails here, and so does deleting the last action a category covers.
 */
describe('audit categories match actions that are really recorded', () => {
  const RECORDED = [
    // auth-service (AuditAction, this file)
    ...Object.values(AuditAction),
    // payment-service — payment.service.ts `this.audit(...)`
    'payment.refund.requested',
    'payment.refund.rejected',
    'payment.refund.settled',
    // depot-service — price-override.service.ts `this.audit(...)`
    'depot.price_override.approved',
    'depot.price_override.rejected',
    'depot.price_override.self_approve_blocked',
  ];

  it.each(Object.entries(AUDIT_CATEGORIES))('%s matches at least one', (_key, words) => {
    const hits = RECORDED.filter((action) =>
      words.some((w) => action.toLowerCase().includes(w)),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  // The other half: a category must not quietly swallow the whole trail either.
  it('leaves the auth noise (otp, token, register) uncategorised rather than mislabelled', () => {
    const words = Object.values(AUDIT_CATEGORIES).flat();
    const uncategorised = RECORDED.filter(
      (action) => !words.some((w) => action.toLowerCase().includes(w)),
    );
    expect(uncategorised).toEqual(
      expect.arrayContaining([
        'auth.register.requested',
        'auth.otp.verified',
        'auth.token.refreshed',
      ]),
    );
  });
});
