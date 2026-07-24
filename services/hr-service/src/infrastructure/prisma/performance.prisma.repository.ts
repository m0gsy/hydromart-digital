import { Injectable } from '@nestjs/common';

import { PerformanceReview } from '../../../prisma/generated/client';
import { PerformanceRepository, PerformanceWrite } from '../../application/ports/performance.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PerformancePrismaRepository implements PerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(data: PerformanceWrite): Promise<PerformanceReview> {
    const { employeeId, periodMonth, score, metrics, reviewerId, note } = data;
    return this.prisma.performanceReview.upsert({
      where: { employeeId_periodMonth: { employeeId, periodMonth } },
      create: { employeeId, periodMonth, score, metrics, reviewerId, note },
      update: { score, metrics, reviewerId, note },
    });
  }

  listByEmployee(employeeId: string): Promise<PerformanceReview[]> {
    return this.prisma.performanceReview.findMany({
      where: { employeeId },
      orderBy: { periodMonth: 'desc' },
    });
  }

  findById(id: string): Promise<PerformanceReview | null> {
    return this.prisma.performanceReview.findUnique({ where: { id } });
  }
}
