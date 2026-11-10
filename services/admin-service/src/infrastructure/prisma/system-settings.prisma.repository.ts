import { Injectable } from '@nestjs/common';
import { StaleWriteError } from '@hydromart/platform';

import {
  SaveSystemSettingsData,
  SystemSettingsRecord,
  SystemSettingsRepository,
} from '../../application/ports/system-settings.repository';
import { PrismaService } from './prisma.service';

// The settings table holds exactly one row, keyed by this fixed id.
const SINGLETON_ID = 'singleton';

@Injectable()
export class SystemSettingsPrismaRepository implements SystemSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SystemSettingsRecord | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return null;
    const { defaultTimezone, currency, serviceRadiusKm, updatedAt } = row;
    return { defaultTimezone, currency, serviceRadiusKm, updatedAt };
  }

  async save(data: SaveSystemSettingsData, expectedUpdatedAt?: Date): Promise<SystemSettingsRecord> {
    if (expectedUpdatedAt) {
      // AAS-13: the check and the write are ONE statement. assertFresh then upsert let two admins both
      // pass the check and the slower one overwrite the faster.
      const { count } = await this.prisma.systemSetting.updateMany({
        where: { id: SINGLETON_ID, updatedAt: expectedUpdatedAt },
        data,
      });
      if (count === 0) throw new StaleWriteError();
      return (await this.get()) as SystemSettingsRecord;
    }
    const row = await this.prisma.systemSetting.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
    const { defaultTimezone, currency, serviceRadiusKm, updatedAt } = row;
    return { defaultTimezone, currency, serviceRadiusKm, updatedAt };
  }
}
