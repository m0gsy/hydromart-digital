'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { EmployeeSelect } from '@/components/hr/employee-select';
import { EmployeeAllowances } from '@/components/hr/employee-allowances';
import { Card, LinkButton, SectionHeader } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { canManageHr, canRunPayroll } from '@/lib/roles';

/** Allowances are per employee, so this page is a picker plus the same panel the detail page shows. */
export default function AllowancesPage() {
  const { t } = useT();
  const { customer } = useAuth();
  /*
   * CA-1-27 — two buttons, two capabilities, and they are genuinely not the same one.
   *
   * `POST /allowances/import` is `@Can('hrPayroll')` (an allowance is salary) and
   * `POST /loans/import` is `@Can('hrAdmin')` (a kasbon is employee master data). One
   * `canManageHr` gated both, so FINANCE — which runs payroll and holds `hrPayroll` — was
   * shown neither, and HEAD_OFFICE was shown an allowance import the server refuses.
   */
  const canImportAllowances = canRunPayroll(customer?.role);
  const canImportLoans = canManageHr(customer?.role);
  const [employeeId, setEmployeeId] = useState('');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={t('hrFix.hrAllowances.title')}
        subtitle={t('hrFix.hrAllowances.subtitle')}
        action={
          canImportAllowances || canImportLoans ? (
            <div className="flex gap-2">
              {canImportAllowances && (
                <LinkButton href="/hr/allowances/import" variant="secondary">
                  Import Excel
                </LinkButton>
              )}
              {canImportLoans && (
                <LinkButton href="/hr/loans/import" variant="secondary">
                  Import Kasbon
                </LinkButton>
              )}
            </div>
          ) : undefined
        }
      />

      {/* G-1: this dropdown is the component the five UUID fields now use — the copy that
          lived here is gone, and its loading and error states moved with it. */}
      <Card className="p-5">
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} />
      </Card>

      {employeeId && <EmployeeAllowances employeeId={employeeId} />}
    </div>
  );
}
