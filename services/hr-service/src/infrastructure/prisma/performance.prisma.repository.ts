import { Injectable } from '@nestjs/common';

import { PerformanceReview } from '../../../prisma/generated/client';
import {
  PerformanceRepository,
  PerformanceWrite,
} from '../../application/ports/performance.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PerformancePrismaRepository implements PerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(data: PerformanceWrite): Promise<PerformanceReview> {
    const { employeeId, periodMonth, managerNote, ...rest } = data;
    // managerNote is spread in only when the caller passed it, so a recomputation that omits
    // it leaves the manager's existing words in place instead of nulling them.
    const values = { ...rest, ...(managerNote !== undefined ? { managerNote } : {}) };
    return this.prisma.performanceReview.upsert({
      where: { employeeId_periodMonth: { employeeId, periodMonth } },
      create: { employeeId, periodMonth, ...values },
      update: values,
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
