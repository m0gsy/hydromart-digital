'use client';

import { useState } from 'react';
import { UserGear } from '@phosphor-icons/react';

import { StaffInvite } from '@/components/hq/staff-invite';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, DepotAdmin, Page } from '@/lib/types';

const FILTER_ROLES = [
  'STAFF_DEPOT',
  'KEPALA_DEPOT',
  'ASSISTANT_SUPERVISOR',
  'SUPERVISOR',
  'MANAGER',
  'DIREKTUR',
  'MARKETING',
  'FINANCE',
  'HR',
  'FRANCHISE_OWNER',
  'HEAD_OFFICE',
  'SUPER_ADMIN',
] as const;

function initials(c: Customer): string {
  const base = c.fullName || c.phone;
  return base
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Design 4a/4b — network staff directory with a role filter and the invite form.
export default function HqStaffPage() {
  const { t } = useT();
  // Deleting is SUPER_ADMIN-only; head office sees every other control on the row.
  const { customer } = useAuth();
  const [roleFilter, setRoleFilter] = useState('');

  const list = useAsync<Page<Customer>>(
    () => api.get(endpoints.auth.staff({ limit: 100, role: roleFilter || undefined }), true),
    [roleFilter],
  );
  const items = list.data?.items ?? [];
  // Fail-soft: with no depot list the rows still render, they just cannot be moved.
  const { data: depotPage } = useAsync<Page<DepotAdmin> | null>(
    () =>
      api
        .get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true)
        .catch(() => null),
    [],
  );
  const depots = depotPage?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserGear size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.staff.title')}</h1>
            <p className="text-sm text-muted">{t('hq.staff.subtitle')}</p>
          </div>
        </div>
        <StaffInvite onSaved={list.reload} />
      </div>

      {/* Role filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={roleFilter === ''} onClick={() => setRoleFilter('')}>
          {t('hq.staff.filterAll')}
        </FilterChip>
        {FILTER_ROLES.map((r) => (
          <FilterChip key={r} active={roleFilter === r} onClick={() => setRoleFilter(r)}>
            {t(`hq.roles.${r}`)}
          </FilterChip>
        ))}
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : items.length === 0 ? (
        <CenterState title={t('hq.staff.empty')} icon={<UserGear size={40} weight="fill" />} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((s) => {
            const active = s.status === 'ACTIVE';
            return (
              <Card key={s.id} className="flex items-center gap-3 p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-extrabold text-brand-700">
                  {initials(s)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.fullName || s.phone}</p>
                  <p className="truncate text-xs text-muted">{s.phone}</p>
                </div>
                <DepotPicker staff={s} depots={depots} onMoved={list.reload} />
                <Badge tone="brand">{t(`hq.roles.${s.role}`)}</Badge>
                <Badge tone={active ? 'success' : 'neutral'}>
                  {active ? t('hq.staff.status.active') : t('hq.staff.status.inactive')}
                </Badge>
                <ActiveToggle staff={s} onChanged={list.reload} />
                {can('staffDelete', customer?.role) && (
                  <DeleteStaff staff={s} onDeleted={list.reload} />
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Move one staff account between depots, inline on their row.
 *
 * Saves on change rather than behind an edit form: it is one field, and the service is the
 * one that decides whether the move is legal (a depot-locked role may not end up with no
 * depot). A refusal is shown on the row instead of being swallowed.
 */
function DepotPicker({
  staff,
  depots,
  onMoved,
}: {
  staff: Customer;
  depots: DepotAdmin[];
  onMoved: () => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (depots.length === 0) return null;

  async function move(depotId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.auth.setStaffDepot(staff.id), { depotId: depotId || null }, true);
      onMoved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.staff.depotMoveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label={t('hq.staff.depot')}
        disabled={busy}
        value={staff.assignedDepotId ?? ''}
        onChange={(e) => void move(e.target.value)}
        className="rounded-lg border border-app bg-transparent px-2 py-1 text-xs font-medium"
      >
        <option value="">{t('hq.staff.noDepot')}</option>
        {depots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Switch one staff login off or back on.
 *
 * The console had no way to do this at all, so a resignation only ever travelled HR → auth.
 * Switching off here also switches their employee record to INACTIVE (a RESIGNED row keeps
 * its stronger status — that carries a reason this button does not know).
 */
function ActiveToggle({ staff, onChanged }: { staff: Customer; onChanged: () => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = staff.status === 'ACTIVE';

  // A deleted account is anonymised; there is nothing left to switch back on.
  if (staff.status === 'DELETED') return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.auth.setStaffActive(staff.id), { active: !active }, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.staff.statusChangeFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className="rounded-lg border border-app px-2.5 py-1 text-xs font-bold text-muted transition-colors hover:bg-brand-50 disabled:opacity-50"
      >
        {active ? t('hq.staff.deactivate') : t('hq.staff.activate')}
      </button>
      {error && (
        <p className="text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Delete a staff account. SUPER_ADMIN only, and it cannot be undone: the identity is
 * anonymised across every service and the login is closed for good.
 *
 * The confirmation is a re-typed name, not a "are you sure?" dialog. Nobody reads those,
 * and this is the one action in the console with nothing behind it.
 */
function DeleteStaff({ staff, onDeleted }: { staff: Customer; onDeleted: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = staff.fullName || staff.phone;

  if (staff.status === 'DELETED') return null;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.auth.deleteStaff(staff.id), true);
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.staff.deleteFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-bold text-red-600 transition-colors hover:bg-red-50"
      >
        {t('hq.staff.delete')}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <p className="text-[11px] font-semibold text-red-700">
        {t('hq.staff.deleteConfirm', { name: label })}
      </p>
      <div className="flex gap-1">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={t('hq.staff.deleteConfirm', { name: label })}
          className="w-40 rounded-lg border border-app bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={busy || typed.trim() !== label}
          onClick={() => void remove()}
          className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40"
        >
          {t('hq.staff.delete')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-app px-2.5 py-1 text-xs font-bold text-muted"
        >
          {t('hq.staff.form.cancel')}
        </button>
      </div>
      {error && (
        <p className="text-[11px] font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-full px-3 py-1.5 text-xs font-bold transition-colors ' +
        (active ? 'bg-brand-600 text-on-brand' : 'border border-app text-muted hover:bg-brand-50')
      }
    >
      {children}
    </button>
  );
}
