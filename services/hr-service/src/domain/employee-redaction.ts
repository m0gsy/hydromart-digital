// What a depot that is only BORROWING an employee may see of them.
//
// The destination's manager runs the person's days (who is on shift, who is late), so they
// need a name, a phone, a code, a post. They do not need - and must not get - the pay, the
// KTP number, the bank account or the home address: that belongs to the depot the person
// belongs to. Same row shape, so every caller that already handles an employee keeps
// working; the sensitive fields are simply null.

import type { Employee } from '../../prisma/generated/client';

const HIDDEN = [
  'nik',
  'npwp',
  'bpjsKes',
  'bpjsTk',
  'bankName',
  'bankAccount',
  'dailyRate',
  'monthlyRate',
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
