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

  /** Load the patch from the database into this process's live map. */
  async refresh(): Promise<CapabilityOverrides> {
    const rows = await this.overrides.listAll();
    const patch: Record<string, readonly AccessRole[]> = {};
    for (const row of rows) {
      patch[row.capability] = row.roles;
    }
    loadOverrides(patch);
    return patch;
  }

  /** The patch as the pollers consume it. */
  async patch(): Promise<CapabilityOverrides> {
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
