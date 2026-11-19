import { ForbiddenException } from '@nestjs/common';
import { can } from '@hydromart/access';
import type { AuthenticatedUser } from '@hydromart/platform';

/**
 * Pay figures go to `payrollRead` and to no one else (owner decision 2026-11-19). Checked where a
 * response leaves, not inside the services: they also load employees and payrolls for their own
 * work (generate, adjustments), which must keep the real numbers.
 */
export const mayReadPay = (user: AuthenticatedUser): boolean => can('payrollRead', user.role);

export function assertMayReadPay(user: AuthenticatedUser): void {
  if (!mayReadPay(user)) {
    throw new ForbiddenException(
      'Angka gaji hanya untuk HR, keuangan, kantor pusat, direksi, manajer dan pemilik depot.',
    );
  }
}

/** An employee row without its rate, for a role that may see the person but not the pay. */
export function withoutRate<T extends { dailyRate?: unknown; monthlyRate?: unknown }>(employee: T): T {
  return { ...employee, dailyRate: null, monthlyRate: null };
}
