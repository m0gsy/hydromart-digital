import type { CustomRoleScope } from '@hydromart/access';

export interface CustomRoleRecord {
  key: string;
  name: string;
  description: string | null;
  scope: CustomRoleScope;
  archivedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepotOverrideRecord {
  capability: string;
  roleKey: string;
  depotId: string;
  effect: 'GRANT' | 'DENY';
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * Roles a SUPER_ADMIN defined at runtime, and the per-depot exceptions to the matrix.
 * A role is archived, never deleted: audit rows and old tokens keep a name to resolve, and an
 * archived role simply holds nothing.
 */
export interface CustomRoleRepository {
  listAll(): Promise<CustomRoleRecord[]>;
  find(key: string): Promise<CustomRoleRecord | null>;
  create(record: {
    key: string;
    name: string;
    description: string | null;
    scope: CustomRoleScope;
    createdBy: string | null;
  }): Promise<void>;
  update(
    key: string,
    patch: { name?: string; description?: string | null; scope?: CustomRoleScope },
  ): Promise<void>;
  /**
   * Archive the role and, in the same transaction, strip it from every capability list and
   * drop its depot exceptions, so nothing keeps naming a role that no longer exists.
   */
  archive(key: string): Promise<void>;
  /** Accounts that currently hold this role. Archiving is refused while this is above zero. */
  countHolders(key: string): Promise<number>;

  listDepotOverrides(): Promise<DepotOverrideRecord[]>;
  setDepotOverride(
    row: { capability: string; roleKey: string; depotId: string; effect: 'GRANT' | 'DENY' },
    updatedBy: string | null,
  ): Promise<void>;
  removeDepotOverride(capability: string, roleKey: string, depotId: string): Promise<void>;
}
