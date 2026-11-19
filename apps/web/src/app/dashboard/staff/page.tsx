'use client';

import { useState } from 'react';
import { Lock, UserGear } from '@phosphor-icons/react';

import { StaffInvite } from '@/components/hq/staff-invite';
import { RequireAuth } from '@/components/require-auth';
import { StaffDirectory } from '@/components/staff/staff-directory';
import { Badge, Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { CAPABILITIES, canManageStaff, type Capability } from '@/lib/roles';

// Reference matrix "Peran & hak akses" (7b). Rows are just (label -> capability):
// the actual role lists are read from CAPABILITIES in lib/roles.ts — the SAME map
// that gates every route — so this can never drift from what the app enforces.
// Display-only; the server stays authority.
const ACCESS_MATRIX: { id: string; cap: Capability }[] = [
  { id: 'orderQueue', cap: 'orderQueue' },
  { id: 'inventoryWrite', cap: 'inventoryWrite' },
  { id: 'returnsWrite', cap: 'returnsWrite' },
  { id: 'dynPricing', cap: 'depotAdmin' },
  { id: 'manageDepot', cap: 'depotAdmin' },
  { id: 'tracking', cap: 'tracking' },
  { id: 'campaignWrite', cap: 'campaignWrite' },
  { id: 'voucherWrite', cap: 'voucherWrite' },
  { id: 'opsNotif', cap: 'opsNotif' },
  { id: 'courierSettle', cap: 'courierSettle' },
  { id: 'expenseApprove', cap: 'expenseApprove' },
  { id: 'depotBroadcast', cap: 'depotBroadcast' },
  { id: 'staffAdmin', cap: 'staffAdmin' },
  { id: 'payout', cap: 'payout' },
  { id: 'dashboard', cap: 'dashboard' },
];

function AccessMatrix() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="font-semibold">{t('dashC.staff.matrixTitle')}</span>
        <span className="text-sm font-medium text-brand-600">{open ? t('dashC.staff.matrixClose') : t('dashC.staff.matrixOpen')}</span>
      </button>
      {open && (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {ACCESS_MATRIX.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-44 text-sm font-medium">{t(`dashC.staff.matrix.${row.id}`)}</span>
              <span className="flex flex-wrap gap-1.5">
                {CAPABILITIES[row.cap].map((r) => (
                  <Badge key={r} tone="neutral">
                    {t(`dashC.staff.roleLabel.${r}`)}
                  </Badge>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/*
 * Flow plan 5e: the same directory as /hq/staff — each account's depot, status and HR record,
 * and the head-office controls on the row — so head office on the phone, where the Ops app
 * has no /hq, is not left with a read-only list. The route stays: the app carries /dashboard.
 */
function StaffBody() {
  const { t } = useT();
  return (
    <StaffDirectory
      header={(reload) => (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UserGear size={24} weight="fill" className="text-brand-500" />
              <h1 className="text-2xl font-bold">{t('dashC.staff.title')}</h1>
            </div>
            <StaffInvite onSaved={reload} />
          </div>
          <AccessMatrix />
        </>
      )}
    />
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManageStaff(customer?.role)) {
    return (
      <CenterState title={t('dashC.staff.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashC.staff.gateBody')}
      </CenterState>
    );
  }
  return <StaffBody />;
}

export default function StaffPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
