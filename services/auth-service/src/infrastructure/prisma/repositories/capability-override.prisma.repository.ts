import { Injectable } from '@nestjs/common';

import {
  CapabilityOverrideRecord,
  CapabilityOverrideRepository,
} from '../../../application/ports/capability-override.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CapabilityOverridePrismaRepository implements CapabilityOverrideRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<CapabilityOverrideRecord[]> {
    const rows = await this.prisma.capabilityOverride.findMany({ orderBy: { capability: 'asc' } });
    return rows.map((r) => ({
      capability: r.capability,
      roles: r.roles,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    }));
  }

  async upsert(capability: string, roles: string[], updatedBy: string | null): Promise<void> {
    const value = roles;
    await this.prisma.capabilityOverride.upsert({
      where: { capability },
      create: { capability, roles: value, updatedBy },
      update: { roles: value, updatedBy },
    });
  }

  async applyAll(
    changes: { capability: string; roles: string[] | null }[],
    updatedBy: string | null,
  ): Promise<void> {
    if (changes.length === 0) return;
    await this.prisma.$transaction(
      changes.map((c) => {
        if (c.roles === null) {
          return this.prisma.capabilityOverride.deleteMany({ where: { capability: c.capability } });
        }
        const value = c.roles;
        return this.prisma.capabilityOverride.upsert({
          where: { capability: c.capability },
          create: { capability: c.capability, roles: value, updatedBy },
          update: { roles: value, updatedBy },
        });
      }),
    );
  }

  async remove(capability: string): Promise<void> {
    // deleteMany, not delete: resetting a capability that was never overridden is a
    // no-op, not a 404 — the caller asked for "back to default" and that is the state.
    await this.prisma.capabilityOverride.deleteMany({ where: { capability } });
  }
}
