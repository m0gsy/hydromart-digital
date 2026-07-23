'use client';

import { useState } from 'react';
import { Lock, UserGear, UserPlus } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { CAPABILITIES, canManageStaff, type Capability } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, Page } from '@/lib/types';

// Staff roles selectable in the invite form (CUSTOMER is not assignable here).
const STAFF_ROLES = [
  'DRIVER',
  'DEPOT_OPERATOR',
  'DEPOT_MANAGER',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'FINANCE',
  'MARKETING',
  'SUPER_ADMIN',
] as const;

function selectClass() {
  return 'w-full rounded-xl border border-app bg-transparent px-3 py-2.5 text-sm font-medium';
}

function InviteForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>('DEPOT_OPERATOR');
  const [vehicleType, setVehicleType] = useState('MOTOR');
  const [plateNumber, setPlateNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDriver = role === 'DRIVER';

  async function submit() {
    if (phone.trim() === '') {
      setError(t('dashC.staff.invalidPhone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.auth.inviteStaff,
        {
          phone: phone.trim(),
          role,
          fullName: fullName || undefined,
          // Vehicle info is courier-only; the server ignores it for other roles.
          vehicleType: isDriver ? vehicleType : undefined,
          plateNumber: isDriver && plateNumber.trim() ? plateNumber.trim() : undefined,
        },
        true,
      );
      setPhone('');
      setFullName('');
      setPlateNumber('');
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashC.staff.inviteError'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <UserPlus size={16} weight="bold" className="mr-1.5" />
        {t('dashC.staff.inviteBtn')}
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">{t('dashC.staff.inviteTitle')}</p>
      <p className="text-xs text-muted">
        {t('dashC.staff.inviteHint')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dashC.staff.phone')} htmlFor="st-phone">
          <Input id="st-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62812…" autoFocus />
        </Field>
        <Field label={t('dashC.staff.fullName')} htmlFor="st-name">
          <Input id="st-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="mis. Budi" />
        </Field>
      </div>
      <Field label={t('dashC.staff.role')} htmlFor="st-role">
        <select id="st-role" value={role} onChange={(e) => setRole(e.target.value)} className={selectClass()}>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`dashC.staff.roleLabel.${r}`)}
            </option>
          ))}
        </select>
      </Field>
      {isDriver && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('dashC.staff.vehicleType')} htmlFor="st-vtype">
            <select id="st-vtype" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className={selectClass()}>
              <option value="MOTOR">{t('dashC.staff.motor')}</option>
              <option value="MOBIL">{t('dashC.staff.car')}</option>
            </select>
          </Field>
          <Field label={t('dashC.staff.plate')} htmlFor="st-plate">
            <Input id="st-plate" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} placeholder="mis. B 1234 ABC" />
          </Field>
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t('dashC.staff.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('dashC.staff.save')}
        </Button>
      </div>
    </Card>
  );
}

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
        <InviteForm onSaved={list.reload} />
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
