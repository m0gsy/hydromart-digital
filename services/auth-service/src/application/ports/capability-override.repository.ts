import type { Role } from '@hydromart/access';

export interface CapabilityOverrideRecord {
  capability: string;
  roles: Role[];
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * SUPER_ADMIN edits to the compiled RBAC matrix. Sparse on purpose: a capability with
 * no row keeps its compiled default, so "reset" is a delete and an empty store is
 * exactly the behaviour shipped in the binary.
 */
export interface CapabilityOverrideRepository {
  /** Every override, for the matrix editor and the internal poll endpoint. */
  listAll(): Promise<CapabilityOverrideRecord[]>;
  /** Create or replace one capability's role list. */
  upsert(capability: string, roles: Role[], updatedBy: string | null): Promise<void>;
  /** Drop one capability's override, returning it to the compiled default. */
  remove(capability: string): Promise<void>;
}
