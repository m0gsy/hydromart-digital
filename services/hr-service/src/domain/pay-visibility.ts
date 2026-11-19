import { ForbiddenException } from '@nestjs/common';
import { can } from '@hydromart/access';
import type { AuthenticatedUser } from '@hydromart/platform';

import { PAY_FIELDS } from './employee-redaction';

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

/**
 * The employee record keeps its rate for an `hrAdmin` holder too: the edit form round-trips the
 * whole record, and an editor handed a blank rate would have to type one over the real salary.
 * Every built-in hrAdmin role reads pay anyway; this matters only for a role retuned in the matrix.
 */
export const mayReadRates = (user: AuthenticatedUser): boolean =>
  mayReadPay(user) || can('hrAdmin', user.role);

/** An employee row without its rate, for a role that may see the person but not the pay. */
export function withoutRate<T extends object>(employee: T): T {
  const copy = { ...employee } as Record<string, unknown>;
  for (const field of PAY_FIELDS) copy[field] = null;
  return copy as T;
}

/** A history entry that records a pay change keeps the fact of the change, not the amounts. */
export function withoutPayChange<T extends { changeType: string; fromValue: unknown; toValue: unknown }>(
  entry: T,
): T {
  return (PAY_FIELDS as readonly string[]).includes(entry.changeType)
    ? { ...entry, fromValue: null, toValue: null }
    : entry;
}
