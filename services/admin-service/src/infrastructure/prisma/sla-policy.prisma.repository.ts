import { Injectable } from '@nestjs/common';

import {
  SaveSlaPolicyData,
  SlaPolicyRecord,
  SlaPolicyRepository,
} from '../../application/ports/sla-policy.repository';
import { PrismaService } from './prisma.service';

// The policy table holds exactly one row, keyed by this fixed id.
const SINGLETON_ID = 'singleton';

@Injectable()
export class SlaPolicyPrismaRepository implements SlaPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SlaPolicyRecord | null> {
    const row = await this.prisma.slaPolicy.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return null;
    const { onTimeThresholdMinutes, healthyBandPct, criticalBandPct, updatedAt } = row;
    return { onTimeThresholdMinutes, healthyBandPct, criticalBandPct, updatedAt };
  }

  async save(data: SaveSlaPolicyData): Promise<SlaPolicyRecord> {
    const row = await this.prisma.slaPolicy.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
    const { onTimeThresholdMinutes, healthyBandPct, criticalBandPct, updatedAt } = row;
    return { onTimeThresholdMinutes, healthyBandPct, criticalBandPct, updatedAt };
  }
}
