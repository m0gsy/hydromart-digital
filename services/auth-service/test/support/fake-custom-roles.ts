import {
  CustomRoleRecord,
  CustomRoleRepository,
  DepotOverrideRecord,
} from '../../src/application/ports/custom-role.repository';
import { AuditService } from '../../src/application/services/audit.service';

/** In-memory twin of the Prisma repository, including the archive-strips-references behaviour. */
export class FakeCustomRoles implements CustomRoleRepository {
  roles = new Map<string, CustomRoleRecord>();
  depot = new Map<string, DepotOverrideRecord>();
  holders = new Map<string, number>();

  listAll(): Promise<CustomRoleRecord[]> {
    return Promise.resolve([...this.roles.values()]);
  }

  find(key: string): Promise<CustomRoleRecord | null> {
    return Promise.resolve(this.roles.get(key) ?? null);
  }

  create(r: Parameters<CustomRoleRepository['create']>[0]): Promise<void> {
    this.roles.set(r.key, { ...r, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0) });
    return Promise.resolve();
  }

  update(key: string, patch: Parameters<CustomRoleRepository['update']>[1]): Promise<void> {
    const cur = this.roles.get(key) as CustomRoleRecord;
    this.roles.set(key, { ...cur, ...patch });
    return Promise.resolve();
  }

  archive(key: string): Promise<void> {
    const cur = this.roles.get(key) as CustomRoleRecord;
    this.roles.set(key, { ...cur, archivedAt: new Date(1) });
    for (const [k, v] of this.depot) if (v.roleKey === key) this.depot.delete(k);
    return Promise.resolve();
  }

  countHolders(key: string): Promise<number> {
    return Promise.resolve(this.holders.get(key) ?? 0);
  }

  listDepotOverrides(): Promise<DepotOverrideRecord[]> {
    return Promise.resolve([...this.depot.values()]);
  }

  setDepotOverride(
    row: { capability: string; roleKey: string; depotId: string; effect: 'GRANT' | 'DENY' },
    updatedBy: string | null,
  ): Promise<void> {
    this.depot.set(`${row.capability}|${row.roleKey}|${row.depotId}`, {
      ...row,
      updatedBy,
      updatedAt: new Date(0),
    });
    return Promise.resolve();
  }

  removeDepotOverride(capability: string, roleKey: string, depotId: string): Promise<void> {
    this.depot.delete(`${capability}|${roleKey}|${depotId}`);
    return Promise.resolve();
  }
}

/** Records what the service wrote to the trail. */
export class FakeAudit {
  entries: { action: string; customerId: string | null; metadata?: Record<string, unknown> }[] = [];
  record(entry: { action: string; customerId: string | null; metadata?: Record<string, unknown> }): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

export const asAudit = (a: FakeAudit): AuditService => a as unknown as AuditService;
