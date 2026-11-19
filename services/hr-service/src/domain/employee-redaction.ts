// What a depot that is only BORROWING an employee may see of them.
//
// The destination's manager runs the person's days (who is on shift, who is late), so they
// need a name, a phone, a code, a post. They do not need - and must not get - the pay, the
// KTP number, the bank account or the home address: that belongs to the depot the person
// belongs to. Same row shape, so every caller that already handles an employee keeps
// working; the sensitive fields are simply null.

import type { Employee } from '../../prisma/generated/client';

/** The employee's pay. Also blanked for a reader without `payrollRead` (domain/pay-visibility). */
export const PAY_FIELDS = ['dailyRate', 'monthlyRate'] as const satisfies readonly (keyof Employee)[];

const HIDDEN = [
  ...PAY_FIELDS,
  'nik',
  'npwp',
  'bpjsKes',
  'bpjsTk',
  'bankName',
  'bankAccount',
  'birthDate',
  'gender',
  'address',
  'ptkpStatus',
  'emergencyName',
  'emergencyPhone',
  'contractEndDate',
  'email',
] as const satisfies readonly (keyof Employee)[];

export function redactForLendingDepot<T extends Employee>(employee: T): T {
  const copy = { ...employee };
  for (const field of HIDDEN) (copy as Record<string, unknown>)[field] = null;
  return copy;
}
