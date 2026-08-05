import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import {
  CAPABILITIES,
  currentOverrides,
  effectiveMatrix,
  loadOverrides,
  type Capability,
  type CapabilityOverrides,
  type Role as AccessRole,
} from '@hydromart/access';

import { CapabilityOverrideRepository } from '../ports/capability-override.repository';
import { Role } from '../../domain/customer/role.enum';
import { AUTH_TOKENS } from '../tokens';

export interface AccessMatrixView {
  /** What the code ships with. */
  defaults: Record<string, readonly AccessRole[]>;
  /** Only the capabilities a super admin has changed. */
  overrides: CapabilityOverrides;
  /** defaults with overrides applied — what the guards actually enforce. */
  effective: Record<string, readonly AccessRole[]>;
}

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * Reads and edits the RBAC matrix. auth-service owns it because it already owns the
 * Role enum and the accounts the roles sit on; every other service polls the result.
 */
@Injectable()
export class AccessMatrixService {
  constructor(
    @Inject(AUTH_TOKENS.CapabilityOverrideRepository)
    private readonly overrides: CapabilityOverrideRepository,
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
  private cached: { at: number; patch: CapabilityOverrides } | null = null;

  /** Load the patch from the database into this process's live map. */
  async refresh(): Promise<CapabilityOverrides> {
    const rows = await this.overrides.listAll();
    const patch: Record<string, readonly AccessRole[]> = {};
    for (const row of rows) {
      patch[row.capability] = row.roles;
    }
    loadOverrides(patch);
    this.cached = { at: Date.now(), patch };
    return patch;
  }

  /** The patch as the pollers consume it — from the last read while it is still fresh. */
  async patch(): Promise<CapabilityOverrides> {
    if (this.cached && Date.now() - this.cached.at < AccessMatrixService.PATCH_TTL_MS) {
      return this.cached.patch;
    }
    return this.refresh();
  }

  async view(): Promise<AccessMatrixView> {
    await this.refresh();
    return {
      defaults: CAPABILITIES as Record<string, readonly AccessRole[]>,
      overrides: currentOverrides(),
      effective: effectiveMatrix(),
    };
  }

  async set(capability: string, roles: string[], actorId: string | null): Promise<void> {
    const known = this.assertKnown(capability);
    const unknownRole = roles.find((r) => !VALID_ROLES.has(r));
    if (unknownRole !== undefined) {
      throw new BadRequestException(`Peran tidak dikenal: ${unknownRole}`);
    }
    // The one irreversible edit this endpoint could make: hand the key to the lock to
    // nobody. can() short-circuits SUPER_ADMIN so the superuser could still get back in,
    // but a matrix that CLAIMS otherwise is a trap for whoever reads it next.
    if (known === 'accessMatrixWrite' && !roles.includes(Role.SUPER_ADMIN)) {
      throw new BadRequestException('SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite.');
    }
    const unique = [...new Set(roles)] as AccessRole[];
    await this.overrides.upsert(known, unique, actorId);
    await this.refresh();
  }

  async reset(capability: string): Promise<void> {
    await this.overrides.remove(this.assertKnown(capability));
    await this.refresh();
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
}
