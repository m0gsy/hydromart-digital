import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Prisma, PerformanceReview } from '../../../prisma/generated/client';
import {
  PERFORMANCE_REPOSITORY,
  PerformanceRepository,
} from '../ports/performance.repository';
import { EmployeeService } from './employee.service';

/** Monthly performance review, one per (employee, period). Depot-checked via the employee. */
@Injectable()
export class PerformanceService {
  constructor(
    @Inject(PERFORMANCE_REPOSITORY) private readonly repo: PerformanceRepository,
    private readonly employees: EmployeeService,
  ) {}

  async upsert(
    user: AuthenticatedUser,
    input: { employeeId: string; periodMonth: string; score: number; metrics?: Record<string, unknown>; note?: string },
  ): Promise<PerformanceReview> {
    await this.employees.getById(user, input.employeeId); // 404 + depot check
    return this.repo.upsert({
      employeeId: input.employeeId,
      periodMonth: input.periodMonth,
      score: input.score,
      metrics: (input.metrics ?? {}) as Prisma.InputJsonValue,
      reviewerId: user.sub,
      note: input.note ?? null,
    });
  }

  async listByEmployee(user: AuthenticatedUser, employeeId: string): Promise<PerformanceReview[]> {
    await this.employees.getById(user, employeeId); // 404 + depot check
    return this.repo.listByEmployee(employeeId);
  }
}
