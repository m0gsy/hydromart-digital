'use client';

import { useState } from 'react';
import { ClockCounterClockwise, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canViewAudit } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { AuditEntry, Page } from '@/lib/types';

// Category chips (design 8b). Mirrors AUDIT_CATEGORIES in auth-service: the substrings
// let the timeline badge each row, while the chip sends `type` for the server filter.
const CATEGORIES: { key: string; match: string[] }[] = [
  { key: 'OPNAME', match: ['opname', 'stock'] },
  { key: 'RECEIPT', match: ['receipt', 'restock', 'purchase'] },
  { key: 'HARGA', match: ['price', 'pricing', 'harga'] },
  { key: 'SETORAN', match: ['settlement', 'cod', 'deposit', 'payout', 'setoran'] },
  { key: 'STAF', match: ['staff', 'role', 'invite', 'login', 'logout'] },
];

/** Returns the matching category key (for i18n lookup), or null. */
function categoryFor(action: string): string | null {
  const a = action.toLowerCase();
  return CATEGORIES.find((c) => c.match.some((s) => a.includes(s)))?.key ?? null;
}

function AuditBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const [type, setType] = useState<string | null>(null);

  const log = useAsync<Page<AuditEntry>>(
    () =>
      scopedId
        ? api.get(endpoints.audit.forDepot(scopedId, { type: type ?? undefined, limit: 100 }), true)
        : Promise.reject(new ApiError(0, 'no depot')),
    [scopedId, type],
  );

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const rows = log.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ClockCounterClockwise size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashA.audit.title')}</h1>
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          {t('dashA.audit.activityForPrefix')}{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          {t('dashA.audit.activityForSuffix')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <ChipButton active={type === null} onClick={() => setType(null)}>
          {t('dashA.audit.all')}
        </ChipButton>
        {CATEGORIES.map((c) => (
          <ChipButton key={c.key} active={type === c.key} onClick={() => setType(c.key)}>
            {t(`dashA.audit.category.${c.key}`)}
          </ChipButton>
        ))}
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashA.audit.noDepotTitle')} icon={<ClockCounterClockwise size={40} weight="fill" />}>
          {t('dashA.audit.noDepotBody')}
        </CenterState>
      ) : log.loading ? (
        <Skeleton className="h-96 w-full" />
      ) : log.error ? (
        <ErrorState message={log.error} onRetry={log.reload} />
      ) : rows.length === 0 ? (
        <CenterState title={t('dashA.audit.emptyTitle')} icon={<ClockCounterClockwise size={40} weight="fill" />}>
          {type ? t('dashA.audit.emptyCategory') : t('dashA.audit.emptyAll')}
        </CenterState>
      ) : (
        <Card className="p-0">
          <ul className="flex flex-col">
            {rows.map((r) => {
              const cat = categoryFor(r.action);
              return (
                <li
                  key={r.id}
                  className="flex items-start gap-3 border-b border-app px-4 py-3 last:border-0"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      r.success ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {r.actorName || r.actorEmail || t('dashA.audit.system')}
                      </span>
                      {cat && <Badge tone="brand">{t(`dashA.audit.category.${cat}`)}</Badge>}
                      {!r.success && <Badge tone="danger">{t('dashA.audit.failed')}</Badge>}
                    </div>
                    <p className="text-sm text-muted">
                      {r.action}
                      {r.target ? ` · ${r.target}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {formatDateTime(r.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ChipButton({
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
      className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-app text-muted hover:text-[color:var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewAudit(customer?.role)) {
    return (
      <CenterState title={t('dashA.audit.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.audit.gateBody')}
      </CenterState>
    );
  }
  return <AuditBody />;
}

export default function AuditPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
