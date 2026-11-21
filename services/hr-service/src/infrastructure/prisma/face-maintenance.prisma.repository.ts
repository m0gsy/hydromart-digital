import { Injectable } from '@nestjs/common';

import {
  FaceMaintenanceRepository,
  FaceShadowSample,
} from '../../application/ports/face-maintenance.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class FaceMaintenancePrismaRepository implements FaceMaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async activeEnrolledEmployeeIds(): Promise<string[]> {
    const rows = await this.prisma.faceEmbedding.findMany({
      where: { active: true },
      select: { employeeId: true },
      distinct: ['employeeId'],
      // ponytail: one row per enrolled employee; page it past ~50k staff.
      take: 50_000,
    });
    return rows.map((r) => r.employeeId);
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
