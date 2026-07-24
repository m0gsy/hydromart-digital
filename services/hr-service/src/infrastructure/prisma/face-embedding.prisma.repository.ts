import { Injectable } from '@nestjs/common';
import { FaceEmbedding } from '../../../prisma/generated/client';

import {
  FaceEmbeddingRepository,
  OwnedVector,
} from '../../application/ports/face-embedding.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class FaceEmbeddingPrismaRepository implements FaceEmbeddingRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    employeeId: string;
    vector: number[];
    quality: number;
    sourcePhotoUrl: string | null;
  }): Promise<FaceEmbedding> {
    return this.prisma.faceEmbedding.create({ data });
  }

  listActiveByEmployee(employeeId: string): Promise<FaceEmbedding[]> {
    return this.prisma.faceEmbedding.findMany({ where: { employeeId, active: true } });
  }

  async listActiveVectorsExcept(employeeId: string): Promise<OwnedVector[]> {
    const rows = await this.prisma.faceEmbedding.findMany({
      where: { active: true, employeeId: { not: employeeId } },
      select: { employeeId: true, vector: true },
    });
    return rows.map((r) => ({ employeeId: r.employeeId, vector: r.vector }));
  }

  async deactivateForEmployee(employeeId: string): Promise<void> {
    await this.prisma.faceEmbedding.updateMany({
      where: { employeeId, active: true },
      data: { active: false },
    });
  }
}
