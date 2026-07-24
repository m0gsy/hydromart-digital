import { Prisma, PerformanceReview } from '../../../prisma/generated/client';

export const PERFORMANCE_REPOSITORY = Symbol('PERFORMANCE_REPOSITORY');

export interface PerformanceWrite {
  employeeId: string;
  periodMonth: string;
  score: number;
  metrics: Prisma.InputJsonValue;
  reviewerId: string | null;
  note: string | null;
}

export interface PerformanceRepository {
  /** Upsert on the unique (employeeId, periodMonth): one review per employee per month. */
  upsert(data: PerformanceWrite): Promise<PerformanceReview>;
  listByEmployee(employeeId: string): Promise<PerformanceReview[]>;
  findById(id: string): Promise<PerformanceReview | null>;
}
