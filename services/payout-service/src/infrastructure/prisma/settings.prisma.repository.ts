import { Injectable } from '@nestjs/common';
import { SettingRow } from '@hydromart/platform';

import { SettingsRepository } from '../../application/ports/settings.repository';
import { PrismaService } from './prisma.service';

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
    // Emulate the partial-unique target: find existing, then update or create.
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
    await this.prisma.serviceSetting.create({
      data: {
        scope: row.scope,
        depotId: row.depotId,
        key: row.key,
        value: row.value,
        updatedBy: row.updatedBy,
      },
    });
  }

  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    await this.prisma.serviceSetting.deleteMany({ where: { scope, depotId, key } });
  }
}
