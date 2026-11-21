import { Injectable } from '@nestjs/common';

import {
  FaceMaintenanceRepository,
  FaceShadowSample,
} from '../../application/ports/face-maintenance.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class FaceMaintenancePrismaRepository implements FaceMaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  activeEnrolments(): Promise<{ employeeId: string; createdAt: Date }[]> {
    return this.prisma.faceEmbedding.findMany({
      where: { active: true },
      select: { employeeId: true, createdAt: true },
      // ponytail: one active row per enrolled employee; page it past ~50k staff.
      take: 50_000,
    });
  }

  async consentedSince(since: Date): Promise<string[]> {
    const rows = await this.prisma.employee.findMany({
      where: { faceConsentAt: { gte: since } },
      select: { id: true },
      take: 10_000,
    });
    return rows.map((r) => r.id);
  }

  async recordShadowSample(sample: FaceShadowSample): Promise<void> {
    await this.prisma.faceShadowSample.create({ data: sample });
  }

  async purgeShadowSamples(before: Date): Promise<number> {
    const { count } = await this.prisma.faceShadowSample.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return count;
  }
}
