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
  /**
   * Apply several edits as ONE database transaction: every `roles` list is written and
   * every `null` is a reset, or nothing at all happens.
   *
   * The matrix editor sends a whole screenful of changes at once, and doing that as N
   * separate requests meant a failure on the fourth left the first three enforced while
   * the screen still showed all of them as unsaved — a permission set nobody chose, which
   * "Reset" then appeared to undo without touching the server at all.
   */
  applyAll(
    changes: { capability: string; roles: Role[] | null }[],
    updatedBy: string | null,
  ): Promise<void>;
}
