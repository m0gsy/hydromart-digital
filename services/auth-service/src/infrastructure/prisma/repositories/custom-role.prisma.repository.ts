import { Injectable } from '@nestjs/common';

import type { CustomRoleScope } from '@hydromart/access';

import {
  CustomRoleRecord,
  CustomRoleRepository,
  DepotOverrideRecord,
} from '../../../application/ports/custom-role.repository';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CustomRolePrismaRepository implements CustomRoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<CustomRoleRecord[]> {
    const rows = await this.prisma.customRole.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ ...r, scope: r.scope as CustomRoleScope }));
  }

  async find(key: string): Promise<CustomRoleRecord | null> {
    const r = await this.prisma.customRole.findUnique({ where: { key } });
    return r ? { ...r, scope: r.scope as CustomRoleScope } : null;
  }

  async create(record: {
    key: string;
    name: string;
    description: string | null;
    scope: CustomRoleScope;
    createdBy: string | null;
  }): Promise<void> {
    await this.prisma.customRole.create({ data: record });
  }

  async update(
    key: string,
    patch: { name?: string; description?: string | null; scope?: CustomRoleScope },
  ): Promise<void> {
    await this.prisma.customRole.update({ where: { key }, data: patch });
  }

  async archive(key: string): Promise<void> {
    const lists = await this.prisma.capabilityOverride.findMany({
      where: { roles: { has: key } },
    });
    await this.prisma.$transaction([
      this.prisma.customRole.update({ where: { key }, data: { archivedAt: new Date() } }),
      ...lists.map((row) =>
        this.prisma.capabilityOverride.update({
          where: { capability: row.capability },
          data: { roles: row.roles.filter((r) => r !== key) },
        }),
      ),
      this.prisma.capabilityDepotOverride.deleteMany({ where: { roleKey: key } }),
    ]);
  }

  countHolders(key: string): Promise<number> {
    return this.prisma.customer.count({ where: { role: key } });
  }

  async listDepotOverrides(): Promise<DepotOverrideRecord[]> {
    const rows = await this.prisma.capabilityDepotOverride.findMany({
      orderBy: [{ capability: 'asc' }, { roleKey: 'asc' }, { depotId: 'asc' }],
    });
    return rows.map((r) => ({ ...r, effect: r.effect as 'GRANT' | 'DENY' }));
  }

  async setDepotOverride(
    row: { capability: string; roleKey: string; depotId: string; effect: 'GRANT' | 'DENY' },
    updatedBy: string | null,
  ): Promise<void> {
    const where = {
      capability_roleKey_depotId: {
        capability: row.capability,
        roleKey: row.roleKey,
        depotId: row.depotId,
      },
    };
    await this.prisma.capabilityDepotOverride.upsert({
      where,
      create: { ...row, updatedBy },
      update: { effect: row.effect, updatedBy },
    });
  }

  async removeDepotOverride(capability: string, roleKey: string, depotId: string): Promise<void> {
    // deleteMany: resetting an exception that was never set is a no-op, like `remove` above.
    await this.prisma.capabilityDepotOverride.deleteMany({
      where: { capability, roleKey, depotId },
    });
  }
}
