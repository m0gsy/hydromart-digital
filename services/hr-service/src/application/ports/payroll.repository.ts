import { Payroll, PayrollItem, PayrollItemKind, PayrollStatus } from '../../../prisma/generated/client';

export const PAYROLL_REPOSITORY = Symbol('PAYROLL_REPOSITORY');

export interface PayrollItemInput {
  kind: PayrollItemKind;
  label: string;
  amount: number;
  sourceRef?: string | null;
}

export interface PayrollWrite {
  employeeId: string;
  periodMonth: string;
  gross: number;
  totalBonus: number;
  totalDeduction: number;
  net: number;
  presentDays: number;
  createdBy: string | null;
  items: PayrollItemInput[];
}

export type PayrollWithItems = Payroll & { items: PayrollItem[] };

export interface PayrollRepository {
  findByEmployeeAndPeriod(employeeId: string, periodMonth: string): Promise<PayrollWithItems | null>;
  findById(id: string): Promise<PayrollWithItems | null>;
  /** Create a DRAFT payroll with its item lines (atomic). */
  create(data: PayrollWrite): Promise<PayrollWithItems>;
  /** Replace a DRAFT payroll's fields + items in place (drop old lines first, atomic). */
  regenerate(id: string, data: PayrollWrite): Promise<PayrollWithItems>;
  /** Move status forward (APPROVED/PAID) with the actor + timestamp. */
  setStatus(
    id: string,
    status: PayrollStatus,
    stamp: { approvedBy?: string; approvedAt?: Date; paidAt?: Date },
  ): Promise<PayrollWithItems>;
  list(filter: { periodMonth?: string; employeeId?: string; status?: PayrollStatus; skip: number; take: number }): Promise<{ rows: Payroll[]; total: number }>;
}
