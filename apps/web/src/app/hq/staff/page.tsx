'use client';

import { useState } from 'react';
import { UserGear } from '@phosphor-icons/react';

import { StaffInvite } from '@/components/hq/staff-invite';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Customer, Page } from '@/lib/types';

const FILTER_ROLES = [
  'DEPOT_MANAGER',
  'DEPOT_OPERATOR',
  'DRIVER',
  'MARKETING',
  'FINANCE',
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
  const [roleFilter, setRoleFilter] = useState('');

  const list = useAsync<Page<Customer>>(
    () => api.get(endpoints.auth.staff({ limit: 100, role: roleFilter || undefined }), true),
    [roleFilter],
  );
  const items = list.data?.items ?? [];

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
                <Badge tone="brand">{t(`hq.roles.${s.role}`)}</Badge>
                <Badge tone={active ? 'success' : 'neutral'}>
                  {active ? t('hq.staff.status.active') : t('hq.staff.status.inactive')}
                </Badge>
              </Card>
            );
          })}
        </div>
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
