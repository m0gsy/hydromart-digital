import { Injectable } from '@nestjs/common';

import type { Role } from '@hydromart/access';

import {
  CapabilityOverrideRecord,
  CapabilityOverrideRepository,
} from '../../../application/ports/capability-override.repository';
import { Role as PrismaRole } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class CapabilityOverridePrismaRepository implements CapabilityOverrideRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<CapabilityOverrideRecord[]> {
    const rows = await this.prisma.capabilityOverride.findMany({ orderBy: { capability: 'asc' } });
    return rows.map((r) => ({
      capability: r.capability,
      roles: r.roles as unknown as Role[],
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    }));
  }

  async upsert(capability: string, roles: Role[], updatedBy: string | null): Promise<void> {
    const value = roles as unknown as PrismaRole[];
    await this.prisma.capabilityOverride.upsert({
      where: { capability },
      create: { capability, roles: value, updatedBy },
      update: { roles: value, updatedBy },
    });
  }

  async remove(capability: string): Promise<void> {
    // deleteMany, not delete: resetting a capability that was never overridden is a
    // no-op, not a 404 — the caller asked for "back to default" and that is the state.
    await this.prisma.capabilityOverride.deleteMany({ where: { capability } });
  }
}
