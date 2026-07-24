'use client';

import { useState } from 'react';

import { Badge, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { fmtDate, fmtTime, type AuditLog, type HrPage } from '@/lib/hr';
import { useAsync } from '@/lib/use-async';

const ACTION_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  POST: 'success', PATCH: 'warning', PUT: 'warning', DELETE: 'danger',
};

export default function AuditPage() {
  const [entity, setEntity] = useState('');

  const { data, error, loading, reload } = useAsync<HrPage<AuditLog>>(
    () => api.get<HrPage<AuditLog>>(endpoints.hr.audit({ entity: entity || undefined, pageSize: 100 }), true),
    [entity],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader title="Log Audit" subtitle={data ? `${data.total} entri` : undefined} />
      <Input placeholder="Filter entity (employees, payroll, …)" value={entity} onChange={(e) => setEntity(e.target.value)} className="max-w-xs" />

      {loading && <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && data.rows.length === 0 && <Card className="p-8 text-center text-sm text-muted">Belum ada log.</Card>}
      {data && data.rows.length > 0 && (
        <Card className="divide-y divide-[color:var(--border)]">
          {data.rows.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <Badge tone={ACTION_TONE[l.action] ?? 'neutral'}>{l.action}</Badge>
              <span className="min-w-0 flex-1 truncate"><b>{l.entity}</b>{l.entityId ? ` · ${l.entityId.slice(0, 8)}…` : ''}</span>
              <span className="whitespace-nowrap text-xs text-muted">{fmtDate(l.at)} {fmtTime(l.at)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
