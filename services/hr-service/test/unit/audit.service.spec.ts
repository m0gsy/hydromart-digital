import { AuditLog } from '../../prisma/generated/client';
import { AuditService } from '../../src/application/services/audit.service';
import {
  AuditListFilter,
  AuditRepository,
  AuditWrite,
} from '../../src/application/ports/audit.repository';

function build(writeImpl?: (e: AuditWrite) => Promise<void>) {
  let lastFilter: AuditListFilter | undefined;
  const repo: AuditRepository = {
    write: writeImpl ?? (async () => undefined),
    list: async (filter) => {
      lastFilter = filter;
      return { rows: [{ id: 'a1' } as AuditLog], total: 1 };
    },
    deleteBefore: async () => 3,
  };
  return { svc: new AuditService(repo), filter: () => lastFilter };
}

const entry: AuditWrite = {
  actorId: 'u1',
  action: 'POST',
  entity: 'employees',
  entityId: 'e1',
  before: null,
  after: null,
  ip: '1.2.3.4',
};

describe('AuditService', () => {
  it('records an entry via the repository', async () => {
    const written: AuditWrite[] = [];
    const { svc } = build(async (e) => {
      written.push(e);
    });
    await svc.record(entry);
    expect(written).toEqual([entry]);
  });

  it('swallows a write failure so audit never breaks the request', async () => {
    const { svc } = build(async () => {
      throw new Error('db down');
    });
    await expect(svc.record(entry)).resolves.toBeUndefined();
  });

  /*
   * HR-2: this trail lives in hr-service's own database, so the retention sweep that has
   * covered auth-service's `audit_logs` for a year had never heard of it. It kept the personal
   * data of departed staff with no window at all.
   */
  it('purges rows older than the cutoff and reports the count', async () => {
    const { svc } = build();
    await expect(svc.purgeOlderThan(new Date('2026-01-01'))).resolves.toEqual({ purged: 3 });
  });

  it('translates page/pageSize into skip/take', async () => {
    const { svc, filter } = build();
    const out = await svc.list({ entity: 'payroll', page: 3, pageSize: 20 });
    expect(filter()).toMatchObject({ entity: 'payroll', skip: 40, take: 20 });
    expect(out.total).toBe(1);
  });
});
