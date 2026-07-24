'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge, Card, ErrorState, Input, LinkButton, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  EMPLOYEE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  type Employee,
  type EmployeeStatus,
  type HrPage,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';

const STATUS_TONE: Record<EmployeeStatus, 'success' | 'neutral' | 'danger'> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  RESIGNED: 'danger',
};

export default function EmployeesPage() {
  const { customer } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('');

  const { data, error, loading, reload } = useAsync<HrPage<Employee>>(
    () => api.get<HrPage<Employee>>(endpoints.hr.employees({ search: search || undefined, status: status || undefined, pageSize: 100 }), true),
    [search, status],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SectionHeader
        title="Karyawan"
        subtitle={data ? `${data.total} karyawan` : undefined}
        action={canManageHr(customer?.role) ? <LinkButton href="/hr/employees/new">+ Tambah</LinkButton> : undefined}
      />

      <div className="flex flex-wrap gap-3">
        <Input placeholder="Cari nama / kode / posisi…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EmployeeStatus | '')}
          className="surface-elevated rounded-lg border border-app px-3 py-2.5 text-sm"
        >
          <option value="">Semua status</option>
          {(Object.keys(EMPLOYEE_STATUS_LABEL) as EmployeeStatus[]).map((s) => (
            <option key={s} value={s}>{EMPLOYEE_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {loading && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <Card className="p-8 text-center text-sm text-muted">Tidak ada karyawan.</Card>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((e) => (
            <Link key={e.id} href={`/hr/employees/${e.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-brand-50">
              <div className="min-w-0">
                <p className="truncate font-semibold">{e.fullName}</p>
                <p className="truncate text-xs text-muted">{e.employeeCode} · {e.position} · {EMPLOYMENT_STATUS_LABEL[e.employmentStatus]}</p>
              </div>
              <Badge tone={STATUS_TONE[e.status]}>{EMPLOYEE_STATUS_LABEL[e.status]}</Badge>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
