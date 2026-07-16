import { Injectable } from '@nestjs/common';

import { FlagState } from '../../domain/flag-state';
import {
  FeatureFlagRecord,
  FeatureFlagRepository,
  UpdateFeatureFlagData,
} from '../../application/ports/feature-flag.repository';
import { PrismaService } from './prisma.service';

// Prisma generates a structurally distinct enum, so rows carry `state` as string and are
// cast back to the domain FlagState here (infra only).
interface FlagRow {
  id: string;
  key: string;
  label: string;
  description: string;
  state: string;
  rolloutPct: number | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FeatureFlagPrismaRepository implements FeatureFlagRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: FlagRow): FeatureFlagRecord {
    return { ...row, state: row.state as FlagState };
  }

  async list(): Promise<FeatureFlagRecord[]> {
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => this.toRecord(r));
  }

  async findByKey(key: string): Promise<FeatureFlagRecord | null> {
    const row = await this.prisma.featureFlag.findUnique({ where: { key } });
    return row ? this.toRecord(row) : null;
  }

  async update(key: string, data: UpdateFeatureFlagData): Promise<FeatureFlagRecord | null> {
    // Guard on existence so an unknown key returns null instead of throwing P2025.
    const existing = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!existing) return null;
    const row = await this.prisma.featureFlag.update({ where: { key }, data });
    return this.toRecord(row);
  }
}
