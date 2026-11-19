import { describe, expect, it } from 'vitest';

import { can } from '@hydromart/access';
import { HR_ITEMS, mayOpenHrRow, type HrNavRow } from '@/lib/hr-nav';

/**
 * Owner decision 2026-11-19: pay figures go to `payrollRead` holders only. That means HR, FINANCE,
 * SUPER_ADMIN, HEAD_OFFICE, DIREKTUR, MANAGER and FRANCHISE_OWNER. SUPERVISOR,
 * ASSISTANT_SUPERVISOR and KEPALA_DEPOT keep HR for attendance, leave and the roster, without
 * the doors to the payroll runs and the allowance lines (the server refuses them those reads
 * too).
 */
const row = (href: string) => HR_ITEMS.find((r) => r.href === href) as HrNavRow;

describe('pay screens in the HR console', () => {
  it.each(['/hr/payroll', '/hr/allowances', '/hr/adjustments'])('%s opens for payrollRead only', (href) => {
    for (const role of ['HR', 'FINANCE', 'HEAD_OFFICE', 'DIREKTUR', 'MANAGER'] as const) {
      expect({ role, open: mayOpenHrRow(row(href).can, role) }).toEqual({ role, open: true });
    }
    for (const role of ['SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'KEPALA_DEPOT'] as const) {
      expect({ role, open: mayOpenHrRow(row(href).can, role) }).toEqual({ role, open: false });
    }
  });

  it('the rest of HR is unchanged for a supervisor', () => {
    for (const href of ['/hr/attendance', '/hr/leave', '/hr/employees']) {
      expect(mayOpenHrRow(row(href).can, 'SUPERVISOR')).toBe(true);
    }
  });

  it('a franchise owner reads pay figures (its P&L) but holds no HR door', () => {
    expect(can('payrollRead', 'FRANCHISE_OWNER')).toBe(true);
    expect(can('hrView', 'FRANCHISE_OWNER')).toBe(false);
  });
});
