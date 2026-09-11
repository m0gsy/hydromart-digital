import { describe, expect, it } from 'vitest';

import { grantableRoles } from '@/lib/roles';

/**
 * SEC-AUDIT CORE-1. Both invite forms offered every role to every viewer, so a head-office
 * user could pick SUPER_ADMIN or FINANCE and only learn from a red 403 that auth-service
 * refuses it. The forms now offer exactly what the server will accept — the same
 * `canGrantRole` from `@hydromart/access`, not a second list that can drift from it.
 */
const ALL = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'MARKETING',
  'FINANCE',
  'HR',
  'HEAD_OFFICE',
  'SUPER_ADMIN',
] as const;

describe('grantableRoles', () => {
  it('offers head office no role that carries money or authority it lacks', () => {
    const offered = grantableRoles(ALL, 'HEAD_OFFICE');
    for (const role of ['FINANCE', 'HR', 'MARKETING', 'MANAGER', 'DIREKTUR', 'SUPER_ADMIN']) {
      expect(offered).not.toContain(role);
    }
    expect(offered).toEqual(['STAFF_DEPOT', 'KEPALA_DEPOT', 'SUPERVISOR', 'HEAD_OFFICE']);
  });

  it('offers a superuser everything', () => {
    expect(grantableRoles(ALL, 'SUPER_ADMIN')).toEqual([...ALL]);
  });

  it('keeps the order the form declared', () => {
    expect(grantableRoles(['KEPALA_DEPOT', 'STAFF_DEPOT'] as const, 'HEAD_OFFICE')).toEqual([
      'KEPALA_DEPOT',
      'STAFF_DEPOT',
    ]);
  });

  it('offers an anonymous viewer no restricted role', () => {
    expect(grantableRoles(ALL, null)).not.toContain('FINANCE');
  });
});
