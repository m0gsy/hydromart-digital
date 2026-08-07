'use client';

import { useState } from 'react';
import { ShieldCheck, Warning } from '@phosphor-icons/react';

import { Button, Card, Chip, ErrorState, Skeleton } from '@/components/ui';
import { ConfirmDialog } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { DataSubjectRequest } from '@/lib/types';

/**
 * UU PDP tahap 1 (item 13) — the head-office decision queue.
 *
 * An approved EXPORT returns the payload once, in the response. It is offered as a
 * download and then dropped: keeping a copy of everything we hold about a person, on a
 * console page, would create the second copy the request exists to avoid.
 */
export default function HqPdpPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [onlyPending, setOnlyPending] = useState(true);
  const { data, error, loading, reload } = useAsync<DataSubjectRequest[]>(
    () => api.get(endpoints.pdp.queue(onlyPending ? 'PENDING' : undefined), true),
    [onlyPending],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DataSubjectRequest | null>(null);

  async function approve(row: DataSubjectRequest) {
    setBusy(row.id);
    try {
      const result = await api.post<{ export?: unknown }>(endpoints.pdp.approve(row.id), {}, true);
      if (result.export) {
        downloadBlob(
          `pdp-export-${row.customerId}.json`,
          new Blob([JSON.stringify(result.export, null, 2)], { type: 'application/json' }),
        );
        toast(t('hq.pdp.exportReady'), 'success');
      } else {
        toast(t('hq.pdp.approved'), 'success');
      }
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.pdp.actionError'), 'error');
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  }

  async function reject(row: DataSubjectRequest) {
    const reason = window.prompt(t('hq.pdp.rejectPrompt'));
    // A refusal without a reason tells the customer nothing, and the API refuses it too.
    if (!reason || !reason.trim()) return;
    setBusy(row.id);
    try {
      await api.post(endpoints.pdp.reject(row.id), { reason: reason.trim() }, true);
      toast(t('hq.pdp.rejected'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.pdp.actionError'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.pdp.title')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">{t('hq.pdp.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant={onlyPending ? 'primary' : 'secondary'} onClick={() => setOnlyPending(true)}>
            {t('hq.pdp.filterPending')}
          </Button>
          <Button variant={onlyPending ? 'secondary' : 'primary'} onClick={() => setOnlyPending(false)}>
            {t('hq.pdp.filterAll')}
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-[color:var(--text-muted)]">
          {t('hq.pdp.empty')}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t(`hq.pdp.type.${row.type}`)}</span>
                    <Chip tone="outline">{t(`hq.pdp.status.${row.status}`)}</Chip>
                  </div>
                  <div className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                    {t('hq.pdp.customer')} {row.customerName ?? row.customerId.slice(0, 8)} ·{' '}
                    {t('hq.pdp.requestedAt')}{' '}
                    {formatDateTime(row.requestedAt)}
                  </div>
                  {row.reason && (
                    <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                      {t('hq.pdp.reason')}: {row.reason}
                    </div>
                  )}
                </div>
                {row.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <Button
                      loading={busy === row.id}
                      onClick={() => (row.type === 'DELETE' ? setConfirmDelete(row) : approve(row))}
                    >
                      {t('hq.pdp.approve')}
                    </Button>
                    <Button variant="secondary" onClick={() => reject(row)}>
                      {t('hq.pdp.reject')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-[color:var(--surface-soft)] px-4 py-3 text-xs text-[color:var(--text-muted)]">
        <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0" />
        {t('hq.pdp.deleteWarning')}
      </p>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('hq.pdp.approve')}
        message={t('hq.pdp.deleteWarning')}
        confirmLabel={t('hq.pdp.approve')}
        loading={busy !== null}
        onConfirm={() => confirmDelete && approve(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}
