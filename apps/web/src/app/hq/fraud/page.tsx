'use client';

import { useState } from 'react';
import { ShieldWarning } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, Chip, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { FraudFlag, FraudStatus } from '@/lib/types';

// Design 15b — fraud & risk queue. Real admin-service track: HEAD_OFFICE + SUPER_ADMIN read
// (highest-score-then-newest), review / block / clear. Scores/signals are supplied by an
// ingesting scoring job and stored verbatim — not recomputed in the UI.
type Filter = 'all' | FraudStatus;

function scoreTone(score: number): 'danger' | 'warning' | 'neutral' {
  if (score >= 80) return 'danger';
  if (score >= 60) return 'warning';
  return 'neutral';
}
const STATUS_TONE: Record<FraudStatus, 'warning' | 'brand' | 'danger' | 'success'> = {
  OPEN: 'warning',
  REVIEWED: 'brand',
  BLOCKED: 'danger',
  CLEARED: 'success',
};

export default function HqFraudPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const query = useAsync<FraudFlag[]>(
    () => api.get(endpoints.admin.fraud.list({ status: filter === 'all' ? undefined : filter }), true),
    [filter],
  );

  const chips: Filter[] = ['all', 'OPEN', 'REVIEWED', 'BLOCKED', 'CLEARED'];
  const label = (f: Filter) => (f === 'all' ? t('hq.fraud.all') : t(`hq.fraud.status.${f}`));

  async function act(r: FraudFlag, action: 'review' | 'block' | 'clear') {
    try {
      await api.post(endpoints.admin.fraud[action](r.id), {}, true);
      const key = action === 'block' ? 'blocked' : action === 'clear' ? 'cleared' : 'reviewed';
      toast(t(`hq.fraud.${key}`, { subject: r.entityRef }), action === 'block' ? 'error' : 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.fraud.saveError'), 'error');
    }
  }

  const rows = query.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={ShieldWarning} title={t('hq.fraud.title')} subtitle={t('hq.fraud.subtitle')} />

      <div className="flex flex-wrap gap-2">
        {chips.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
              filter === f ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
            }`}
          >
            {label(f)}
          </button>
        ))}
      </div>

      {query.loading ? (
        <Skeleton className="h-80 w-full" />
      ) : query.error ? (
        <ErrorState message={t('hq.fraud.loadError')} onRetry={query.reload} />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.fraud.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{r.entityRef}</span>
                  <Chip tone="outline">{t(`hq.fraud.type.${r.entityType}`)}</Chip>
                  <Badge tone={scoreTone(r.score)}>
                    {t('hq.fraud.score')} {r.score}
                  </Badge>
                  <Badge tone={STATUS_TONE[r.status]}>{t(`hq.fraud.status.${r.status}`)}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.signals.map((s) => (
                    <Chip key={s} tone="amber">{s}</Chip>
                  ))}
                </div>
              </div>
              {(r.status === 'OPEN' || r.status === 'REVIEWED') && (
                <div className="flex gap-2">
                  {r.status === 'OPEN' && (
                    <Button variant="secondary" onClick={() => act(r, 'review')}>
                      {t('hq.fraud.review')}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => act(r, 'clear')}>
                    {t('hq.fraud.clear')}
                  </Button>
                  <Button variant="danger" onClick={() => act(r, 'block')}>
                    {t('hq.fraud.block')}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
