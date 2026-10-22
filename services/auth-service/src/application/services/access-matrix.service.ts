import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  CAPABILITIES,
  CUSTOM_FORBIDDEN,
  currentCustomRoles,
  currentDepotOverrides,
  currentOverrides,
  effectiveMatrix,
  isCustomRoleKey,
  loadCustomRoles,
  loadDepotOverrides,
  loadOverrides,
  loadRoleSettings,
  rolesFor,
  roleScopeSetting,
  currentRoleSettings,
  SCOPE_FIXED_ROLES,
  UNDISABLEABLE_ROLES,
  type Capability,
  type CapabilityOverrides,
  type CustomRoleDef,
  type CustomRoleScope,
  type DepotOverride,
  type RoleSetting,
} from '@hydromart/access';
import { effectiveScope } from '@hydromart/platform';

import { CapabilityOverrideRepository } from '../ports/capability-override.repository';
import { CustomRoleRecord, CustomRoleRepository } from '../ports/custom-role.repository';
import { Role } from '../../domain/customer/role.enum';
import { AUTH_TOKENS } from '../tokens';
import { AuditService } from './audit.service';

export interface AccessMatrixView {
  /** What the code ships with. */
  defaults: Record<string, readonly string[]>;
  /** Only the capabilities a super admin has changed. */
  overrides: CapabilityOverrides;
  /** defaults with overrides applied — what the guards actually enforce. */
  effective: Record<string, readonly string[]>;
  /** Active custom roles. */
  customRoles: readonly CustomRoleDef[];
  /** Per-depot GRANT/DENY exceptions. */
  depotOverrides: readonly DepotOverride[];
  /** SUPER_ADMIN's settings on built-in roles (name, description, scope, disabled). */
  roleSettings: readonly RoleSetting[];
}

/** What the other services poll: the same three things `can()` needs. */
export interface AccessSnapshot {
  overrides: CapabilityOverrides;
  customRoles: readonly CustomRoleDef[];
  depotOverrides: readonly DepotOverride[];
  roleSettings: readonly RoleSetting[];
}

const BUILT_IN_ROLES = new Set<string>(Object.values(Role));
const SCOPES: readonly CustomRoleScope[] = ['LOCKED', 'RESOLVED', 'GLOBAL'];
const FORBIDDEN = new Set<string>(CUSTOM_FORBIDDEN);

/** `Kasir Depot!` -> `C_kasir_depot`. Lower-case ASCII so a key is safe in a URL and a column. */
export function customRoleKeyFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug ? `C_${slug}` : '';
}

/**
 * Reads and edits the RBAC matrix, the custom roles and the per-depot exceptions.
 * auth-service owns them because it already owns the accounts the roles sit on; every other
 * service polls the result.
 */
@Injectable()
export class AccessMatrixService {
  constructor(
    @Inject(AUTH_TOKENS.CapabilityOverrideRepository)
    private readonly overrides: CapabilityOverrideRepository,
    @Inject(AUTH_TOKENS.CustomRoleRepository)
    private readonly roles: CustomRoleRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * How long a poll may be served from the last read (audit S-8). Sixteen services poll
   * this table on a timer; serving every one of them a fresh SELECT meant the matrix was
   * re-read about thirty times a minute, forever, to answer with the same handful of rows.
   *
   * The window is short because it is also the propagation delay of a matrix edit — and an
   * edit refreshes the cache itself, so the only cost is what OTHER instances wait.
   */
  private static readonly PATCH_TTL_MS = 15_000;
  private cached: { at: number; snapshot: AccessSnapshot } | null = null;

  /** Load everything from the database into this process's live maps. */
  async refresh(): Promise<AccessSnapshot> {
    const [rows, roleRows, depotRows, settingRows] = await Promise.all([
      this.overrides.listAll(),
      this.roles.listAll(),
      this.roles.listDepotOverrides(),
      this.roles.listRoleSettings(),
    ]);
    const patch: Record<string, readonly string[]> = {};
    for (const row of rows) {
      patch[row.capability] = row.roles;
    }
    const customRoles: CustomRoleDef[] = roleRows
      .filter((r) => r.archivedAt === null)
      .map((r) => ({ key: r.key, name: r.name, scope: r.scope }));
    const active = new Set(customRoles.map((r) => r.key));
    // An exception for a role that is no longer active would be dead weight at best.
    const depotOverrides: DepotOverride[] = depotRows
      .filter((o) => BUILT_IN_ROLES.has(o.roleKey) || active.has(o.roleKey))
      .map((o) => ({
        capability: o.capability,
        roleKey: o.roleKey,
        depotId: o.depotId,
        effect: o.effect,
      }));
    const roleSettings: RoleSetting[] = settingRows
      .filter((r) => BUILT_IN_ROLES.has(r.roleKey))
      .map((r) => ({
        roleKey: r.roleKey,
        name: r.name,
        description: r.description,
        scope: r.scope,
        disabled: r.disabledAt !== null,
      }));
    loadOverrides(patch);
    loadCustomRoles(customRoles);
    loadDepotOverrides(depotOverrides);
    loadRoleSettings(roleSettings);
    const snapshot = { overrides: patch, customRoles, depotOverrides, roleSettings };
    this.cached = { at: Date.now(), snapshot };
    return snapshot;
  }

  /** The snapshot as the pollers consume it — from the last read while it is still fresh. */
  async snapshot(): Promise<AccessSnapshot> {
    if (this.cached && Date.now() - this.cached.at < AccessMatrixService.PATCH_TTL_MS) {
      return this.cached.snapshot;
    }
    return this.refresh();
  }

  /** Just the matrix patch — the part auth-service's own boot and the old pollers read. */
  async patch(): Promise<CapabilityOverrides> {
    return (await this.snapshot()).overrides;
  }

  async view(): Promise<AccessMatrixView> {
    await this.refresh();
    return {
      defaults: CAPABILITIES as Record<string, readonly string[]>,
      overrides: currentOverrides(),
      effective: effectiveMatrix(),
      customRoles: currentCustomRoles(),
      depotOverrides: currentDepotOverrides(),
      roleSettings: currentRoleSettings(),
    };
  }

  // ---------------------------------------------------------------- matrix

  async set(capability: string, roles: string[], actorId: string | null): Promise<void> {
    const known = this.assertKnown(capability);
    await this.assertRolesAllowed(known, roles);
    const unique = [...new Set(roles)];
    const before = [...(await this.snapshot()).overrides[known] ?? CAPABILITIES[known]];
    await this.overrides.upsert(known, unique, actorId);
    await this.refresh();
    await this.record('access.matrix.changed', actorId, { changes: [{ capability: known, before, after: unique }] });
  }

  /**
   * Apply a whole screenful of matrix edits at once. `roles: null` means "back to the
   * compiled default", the same thing `reset` does for one capability.
   *
   * Two properties the one-at-a-time path could not have. Every name and every role is
   * checked BEFORE anything is written, so a typo in the fifth edit no longer lands the
   * first four; and the writes go down as one transaction, so a failure halfway leaves
   * the matrix exactly as it was. The RBAC matrix is the one table where "half applied"
   * means a permission set that nobody chose and nobody can see they are living under.
   */
  async applyAll(
    changes: { capability: string; roles: string[] | null }[],
    actorId: string | null,
  ): Promise<void> {
    const seen = new Set<string>();
    const current = (await this.snapshot()).overrides;
    const audit: { capability: string; before: readonly string[]; after: readonly string[] | null }[] = [];
    const planned: { capability: string; roles: string[] | null }[] = [];
    for (const change of changes) {
      const known = this.assertKnown(change.capability);
      if (seen.has(known)) {
        throw new BadRequestException(`Capability disebut dua kali: ${known}`);
      }
      seen.add(known);
      const before = current[known] ?? CAPABILITIES[known];
      if (change.roles === null) {
        planned.push({ capability: known, roles: null });
        audit.push({ capability: known, before, after: null });
        continue;
      }
      await this.assertRolesAllowed(known, change.roles);
      const unique = [...new Set(change.roles)];
      planned.push({ capability: known, roles: unique });
      audit.push({ capability: known, before, after: unique });
    }
    await this.overrides.applyAll(planned, actorId);
    await this.refresh();
    await this.record('access.matrix.changed', actorId, { changes: audit });
  }

  async reset(capability: string, actorId: string | null = null): Promise<void> {
    const known = this.assertKnown(capability);
    const before = (await this.snapshot()).overrides[known] ?? CAPABILITIES[known];
    await this.overrides.remove(known);
    await this.refresh();
    await this.record('access.matrix.reset', actorId, { changes: [{ capability: known, before, after: null }] });
  }

  // ---------------------------------------------------------------- roles

  async listRoles(): Promise<CustomRoleRecord[]> {
    return this.roles.listAll();
  }

  async createRole(
    input: { name: string; description?: string | null; scope?: string; copyFrom?: string },
    actorId: string | null,
  ): Promise<CustomRoleRecord> {
    const name = input.name.trim();
    const source = input.copyFrom;
    if (source !== undefined && (!BUILT_IN_ROLES.has(source) || source === Role.CUSTOMER)) {
      throw new BadRequestException(`Peran sumber tidak dikenal: ${source}`);
    }
    // Copying a role starts from its reach; an explicit scope still wins.
    const scope = this.assertScope(input.scope ?? (source ? effectiveScope(source) : 'LOCKED'));
    const key = customRoleKeyFor(name);
    if (!key) {
      throw new BadRequestException('Nama peran harus memuat huruf atau angka.');
    }
    // Case-insensitive on the name as well: two roles a human cannot tell apart in a dropdown.
    const existing = await this.roles.listAll();
    if (existing.some((r) => r.key === key || r.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`Peran dengan nama itu sudah ada: ${name}`);
    }
    await this.roles.create({ key, name, description: input.description?.trim() || null, scope, createdBy: actorId });
    const copied = source ? await this.copyCapabilities(source, key, actorId) : [];
    await this.refresh();
    await this.record('access.role.created', actorId, { key, name, scope, copyFrom: source ?? null, copied });
    return (await this.roles.find(key)) as CustomRoleRecord;
  }

  /**
   * Give `key` every capability `source` holds right now, minus the ones no custom role may hold.
   * One transaction. If it fails the role is archived again so no half-made copy is left behind.
   */
  private async copyCapabilities(source: string, key: string, actorId: string | null): Promise<string[]> {
    const copied = (Object.keys(CAPABILITIES) as Capability[]).filter(
      (c) => !FORBIDDEN.has(c) && rolesFor(c).includes(source),
    );
    const changes = copied.map((c) => ({ capability: c, roles: [...new Set([...rolesFor(c), key])] }));
    try {
      await this.overrides.applyAll(changes, actorId);
    } catch (err) {
      await this.roles.archive(key);
      throw err;
    }
    return copied;
  }

  async updateRole(
    key: string,
    input: { name?: string; description?: string | null; scope?: string },
    actorId: string | null,
  ): Promise<CustomRoleRecord> {
    const current = await this.requireActiveRole(key);
    const patch: { name?: string; description?: string | null; scope?: CustomRoleScope } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Nama peran tidak boleh kosong.');
      const clash = (await this.roles.listAll()).some(
        (r) => r.key !== key && r.name.toLowerCase() === name.toLowerCase(),
      );
      if (clash) throw new ConflictException(`Peran dengan nama itu sudah ada: ${name}`);
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.scope !== undefined) patch.scope = this.assertScope(input.scope);
    await this.roles.update(key, patch);
    await this.refresh();
    await this.record('access.role.updated', actorId, {
      key,
      before: { name: current.name, scope: current.scope },
      after: patch,
    });
    return (await this.roles.find(key)) as CustomRoleRecord;
  }

  /** Archive. Refused while anyone still holds the role: they would silently lose every capability. */
  async archiveRole(key: string, actorId: string | null): Promise<void> {
    await this.requireActiveRole(key);
    const holders = await this.roles.countHolders(key);
    if (holders > 0) {
      throw new ConflictException(`Peran masih dipakai ${holders} akun. Pindahkan akunnya dulu.`);
    }
    await this.roles.archive(key);
    await this.refresh();
    await this.record('access.role.archived', actorId, { key });
  }

  // ---------------------------------------------------------------- built-in roles

  async listBuiltInRoles(): Promise<RoleSetting[]> {
    await this.refresh();
    return [...currentRoleSettings()];
  }

  /**
   * Name, description and reach of a BUILT-IN role. The reach is a security setting: it is what
   * stops a depot role from reading the whole network, so it is refused for roles outside the
   * depot model, and audited with before and after like every other access change.
   */
  async updateBuiltInRole(
    role: string,
    input: { name?: string | null; description?: string | null; scope?: string | null },
    actorId: string | null,
  ): Promise<void> {
    this.assertBuiltIn(role);
    const patch: { name?: string | null; description?: string | null; scope?: CustomRoleScope | null } = {};
    if (input.name !== undefined) patch.name = input.name?.trim() || null;
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.scope !== undefined) {
      if (input.scope === null) {
        patch.scope = null;
      } else {
        if ((SCOPE_FIXED_ROLES as readonly string[]).includes(role)) {
          throw new BadRequestException(`Cakupan ${role} tidak bisa diubah.`);
        }
        patch.scope = this.assertScope(input.scope);
      }
    }
    const before = { scope: effectiveScope(role), setting: roleScopeSetting(role) ?? null };
    await this.roles.upsertRoleSetting(role, patch, actorId);
    await this.refresh();
    await this.record('access.builtin.updated', actorId, { role, before, after: patch });
  }

  /** Switch a built-in role off (holds nothing, cannot be assigned) or back on. */
  async setBuiltInDisabled(role: string, disabled: boolean, actorId: string | null): Promise<void> {
    this.assertBuiltIn(role);
    if (disabled) {
      if ((UNDISABLEABLE_ROLES as readonly string[]).includes(role)) {
        throw new BadRequestException(`${role} tidak bisa dinonaktifkan.`);
      }
      const holders = await this.roles.countHolders(role);
      if (holders > 0) {
        throw new ConflictException(`Peran masih dipakai ${holders} akun. Pindahkan akunnya dulu.`);
      }
    }
    await this.roles.upsertRoleSetting(role, { disabledAt: disabled ? new Date() : null }, actorId);
    await this.refresh();
    await this.record(disabled ? 'access.builtin.disabled' : 'access.builtin.enabled', actorId, { role });
  }

  private assertBuiltIn(role: string): void {
    if (!BUILT_IN_ROLES.has(role) || role === Role.CUSTOMER) {
      throw new NotFoundException(`Peran bawaan tidak ditemukan: ${role}`);
    }
  }

  // ---------------------------------------------------------------- per-depot

  async setDepotOverride(
    capability: string,
    roleKey: string,
    depotId: string,
    effect: string,
    actorId: string | null,
  ): Promise<void> {
    const known = this.assertKnown(capability);
    if (effect !== 'GRANT' && effect !== 'DENY') {
      throw new BadRequestException('Efek harus GRANT atau DENY.');
    }
    await this.assertRolesAllowed(known, [roleKey], { allowSuperAdmin: false });
    await this.roles.setDepotOverride({ capability: known, roleKey, depotId, effect }, actorId);
    await this.refresh();
    await this.record('access.depotOverride.set', actorId, { capability: known, roleKey, depotId, effect, depotScope: depotId });
  }

  async resetDepotOverride(
    capability: string,
    roleKey: string,
    depotId: string,
    actorId: string | null,
  ): Promise<void> {
    const known = this.assertKnown(capability);
    await this.roles.removeDepotOverride(known, roleKey, depotId);
    await this.refresh();
    await this.record('access.depotOverride.reset', actorId, { capability: known, roleKey, depotId });
  }

  // ---------------------------------------------------------------- validation

  /**
   * Every role named must exist (built-in, or an ACTIVE custom one), SUPER_ADMIN may not be
   * dropped from the key to the lock, and a custom role may not hold a capability that is a way
   * to gain more access. `allowSuperAdmin: false` is for a per-depot row: SUPER_ADMIN bypasses
   * every check, so an exception for it could only ever mislead.
   */
  private async assertRolesAllowed(
    capability: Capability,
    roles: readonly string[],
    opts: { allowSuperAdmin?: boolean } = {},
  ): Promise<void> {
    const active = new Set((await this.roles.listAll()).filter((r) => r.archivedAt === null).map((r) => r.key));
    for (const r of roles) {
      if (isCustomRoleKey(r)) {
        if (!active.has(r)) throw new BadRequestException(`Peran tidak dikenal: ${r}`);
        if (FORBIDDEN.has(capability)) {
          throw new BadRequestException(`Peran custom tidak boleh memegang ${capability}.`);
        }
      } else if (!BUILT_IN_ROLES.has(r)) {
        throw new BadRequestException(`Peran tidak dikenal: ${r}`);
      } else if (r === Role.SUPER_ADMIN && opts.allowSuperAdmin === false) {
        throw new BadRequestException('SUPER_ADMIN tidak memerlukan pengecualian per depot.');
      }
    }
    // The one irreversible edit this endpoint could make: hand the key to the lock to
    // nobody. can() short-circuits SUPER_ADMIN so the superuser could still get back in,
    // but a matrix that CLAIMS otherwise is a trap for whoever reads it next.
    if (
      opts.allowSuperAdmin !== false &&
      capability === 'accessMatrixWrite' &&
      !roles.includes(Role.SUPER_ADMIN)
    ) {
      throw new BadRequestException('SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite.');
    }
  }

  private assertScope(scope: string): CustomRoleScope {
    if (!SCOPES.includes(scope as CustomRoleScope)) {
      throw new BadRequestException('Cakupan harus LOCKED, RESOLVED, atau GLOBAL.');
    }
    return scope as CustomRoleScope;
  }

  private async requireActiveRole(key: string): Promise<CustomRoleRecord> {
    const role = await this.roles.find(key);
    if (!role || role.archivedAt !== null) {
      throw new NotFoundException(`Peran tidak ditemukan: ${key}`);
    }
    return role;
  }

  /**
   * Only names the compiled map declares. The row key is a primary key written from a
   * request body, so an unchecked name would let anyone fill the table with rows no
   * guard reads — and a typo'd "inventoryWirte" would look configured while enforcing
   * nothing.
   */
  private assertKnown(capability: string): Capability {
    if (!Object.prototype.hasOwnProperty.call(CAPABILITIES, capability)) {
      throw new BadRequestException(`Capability tidak dikenal: ${capability}`);
    }
    return capability as Capability;
  }

  /**
   * The audit interceptor flattens a request body to `[N item]`, so a batch edit would log
   * that "something" changed. This writes the before and after of each capability instead.
   */
  private record(action: string, actorId: string | null, metadata: Record<string, unknown>): Promise<void> {
    return this.audit.record({
      customerId: actorId,
      action,
      success: true,
      ipAddress: null,
      userAgent: null,
      metadata,
    });
  }
}
