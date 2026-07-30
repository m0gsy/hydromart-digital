import { Prisma, PerformanceReview } from '../../../prisma/generated/client';

export const PERFORMANCE_REPOSITORY = Symbol('PERFORMANCE_REPOSITORY');

export interface PerformanceWrite {
  employeeId: string;
  periodMonth: string;
  score: number;
  /** Null = not measurable this period. See domain/performance-score.ts. */
  attendanceScore?: number | null;
  disciplineScore?: number | null;
  salesScore?: number | null;
  metrics: Prisma.InputJsonValue;
  reviewerId: string | null;
  note: string | null;
  /**
   * Omitted (not null) leaves whatever the manager last wrote alone — a recomputation must
   * not wipe a human's words.
   */
  managerNote?: string;
}

export interface PerformanceRepository {
  /** Upsert on the unique (employeeId, periodMonth): one review per employee per month. */
  upsert(data: PerformanceWrite): Promise<PerformanceReview>;
  listByEmployee(employeeId: string): Promise<PerformanceReview[]>;
  findById(id: string): Promise<PerformanceReview | null>;
}
