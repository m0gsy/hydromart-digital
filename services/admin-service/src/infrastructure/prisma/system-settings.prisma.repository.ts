import { Injectable } from '@nestjs/common';

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

  async save(data: SaveSystemSettingsData): Promise<SystemSettingsRecord> {
    const row = await this.prisma.systemSetting.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
    const { defaultTimezone, currency, serviceRadiusKm, updatedAt } = row;
    return { defaultTimezone, currency, serviceRadiusKm, updatedAt };
  }
}
