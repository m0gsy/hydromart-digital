import { Injectable } from '@nestjs/common';
import { SettingRow } from '@hydromart/platform';

import { SettingsRepository } from '../../application/ports/settings.repository';
import { PrismaService } from './prisma.service';

/** Prisma unique-constraint violation (P2002), detected without importing the client namespace. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

@Injectable()
export class SettingsPrismaRepository implements SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<SettingRow[]> {
    const rows = await this.prisma.serviceSetting.findMany({
      select: { scope: true, depotId: true, key: true, value: true },
    });
    return rows.map((r) => ({
      scope: r.scope as 'GLOBAL' | 'DEPOT',
      depotId: r.depotId,
      key: r.key,
      value: r.value,
    }));
  }

  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    // Prisma cannot target a partial unique index, so the upsert is written by hand
    // against the two the migration created: find, then update or insert.
    const existing = await this.prisma.serviceSetting.findFirst({
      where: { scope: row.scope, depotId: row.depotId, key: row.key },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.serviceSetting.update({
        where: { id: existing.id },
        data: { value: row.value, updatedBy: row.updatedBy },
      });
      return;
    }
    try {
      await this.prisma.serviceSetting.create({
        data: {
          scope: row.scope,
          depotId: row.depotId,
          key: row.key,
          value: row.value,
          updatedBy: row.updatedBy,
        },
      });
    } catch (error) {
      // H-11: the read above is not a lock, so two admins saving the same setting both
      // reach the insert. The index rejects the second; it applies its value on top rather
      // than becoming a duplicate row that makes the setting flap between two values.
      if (!isUniqueViolation(error)) throw error;
      await this.prisma.serviceSetting.updateMany({
        where: { scope: row.scope, depotId: row.depotId, key: row.key },
        data: { value: row.value, updatedBy: row.updatedBy },
      });
    }
  }

  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    await this.prisma.serviceSetting.deleteMany({ where: { scope, depotId, key } });
  }
}
