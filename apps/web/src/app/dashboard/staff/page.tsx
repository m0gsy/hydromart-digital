'use client';

import { useState } from 'react';
import { Lock, UserGear } from '@phosphor-icons/react';

import { StaffInvite } from '@/components/hq/staff-invite';
import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { CAPABILITIES, canManageStaff, type Capability } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, Page } from '@/lib/types';

// Staff roles selectable in the invite form (CUSTOMER is not assignable here).
const STAFF_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'HR',
  'MARKETING',
  'SUPER_ADMIN',
] as const;

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

function StaffRow({ s }: { s: Customer }) {
  const { t } = useT();
  return (
    <Card className="flex items-center justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <p className="truncate font-semibold">{s.fullName || s.phone}</p>
        <p className="truncate text-xs text-muted">
          {s.phone}
          {s.status !== 'ACTIVE' ? ` · ${s.status}` : ''}
        </p>
      </div>
      <Badge tone="brand">{t(`dashC.staff.roleLabel.${s.role}`)}</Badge>
    </Card>
  );
}

function StaffBody() {
  const { t } = useT();
  const [roleFilter, setRoleFilter] = useState('');
  const list = useAsync<Page<Customer>>(
    () => api.get(endpoints.auth.staff({ limit: 100, role: roleFilter || undefined }), true),
    [roleFilter],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserGear size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('dashC.staff.title')}</h1>
        </div>
        <StaffInvite onSaved={list.reload} />
      </div>

      <AccessMatrix />

      <div className="flex items-center gap-2">
        <label htmlFor="st-filter" className="text-sm font-medium text-muted">
          {t('dashC.staff.role')}
        </label>
        <select
          id="st-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm font-medium"
        >
          <option value="">{t('dashC.staff.all')}</option>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`dashC.staff.roleLabel.${r}`)}
            </option>
          ))}
        </select>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.items.length === 0 ? (
        <CenterState title={t('dashC.staff.emptyTitle')} icon={<UserGear size={40} weight="fill" />}>
          {t('dashC.staff.emptyBody')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data.items.map((s) => (
            <StaffRow key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
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
