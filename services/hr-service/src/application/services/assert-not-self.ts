import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee } from '../../../prisma/generated/client';

/** Fields that decide an employee's authority or pay: never self-editable (HR-13). */
const SELF_LOCKED = [
  'role',
  'status',
  'employmentStatus',
  'authSubjectId',
  'salaryType',
  'dailyRate',
  'monthlyRate',
] as const;

/**
 * Refuses when the caller is editing their OWN record. With `input`, only the locked fields
 * count (a name or bank fix is fine); without it (allowances) any touch is refused.
 */
export function assertNotSelf(
  user: AuthenticatedUser,
  employee: Pick<Employee, 'authSubjectId'>,
  input?: Record<string, unknown>,
): void {
  if (!employee.authSubjectId || employee.authSubjectId !== user.sub) return;
  if (input && !SELF_LOCKED.some((k) => input[k] !== undefined)) return;
  throw new ForbiddenException('Anda tidak boleh mengubah jabatan, status, gaji, atau tunjangan Anda sendiri');
}
