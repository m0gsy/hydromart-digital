import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Employee } from '../../prisma/generated/client';
import { assertNotSelf } from '../../src/application/services/assert-not-self';

/** HR-13: nobody edits their own pay, role, status or login link. */
const me: AuthenticatedUser = { sub: 'sub-1', role: 'HR' as never, phone: null, depotId: null };
const mine = { id: 'e1', authSubjectId: 'sub-1' } as Employee;
const theirs = { id: 'e2', authSubjectId: 'sub-2' } as Employee;

describe('assertNotSelf (HR-13)', () => {
  it.each(['role', 'status', 'employmentStatus', 'authSubjectId', 'salaryType', 'dailyRate', 'monthlyRate'])(
    'refuses a self-edit of %s',
    (field) => {
      expect(() => assertNotSelf(me, mine, { [field]: 1 })).toThrow(ForbiddenException);
    },
  );

  it('lets somebody edit a self field on another person', () => {
    expect(() => assertNotSelf(me, theirs, { role: 'X' })).not.toThrow();
  });

  it('lets somebody edit their own harmless fields', () => {
    expect(() => assertNotSelf(me, mine, { address: 'Jl. A', bankName: 'BCA' })).not.toThrow();
  });

  it('ignores fields sent as undefined', () => {
    expect(() => assertNotSelf(me, mine, { role: undefined })).not.toThrow();
  });

  it('with no allowed-field list, refuses any touch (allowance path)', () => {
    expect(() => assertNotSelf(me, mine)).toThrow(ForbiddenException);
    expect(() => assertNotSelf(me, theirs)).not.toThrow();
  });
});
