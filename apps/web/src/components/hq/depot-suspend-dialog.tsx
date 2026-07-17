'use client';

import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';

import { Button, Chip, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Page, Order } from '@/lib/types';

// Design 10b — destructive "Tangguhkan Depot?" confirm. Impact preview + a
// typed-code guard: the deactivate button stays disabled until the operator types
// the depot's exact code. Wires to the REAL deactivate call (DELETE = soft-delete).
export function DepotSuspendDialog({
  depot,
  onClose,
  onSuspended,
}: {
  depot: { id: string; code: string; name: string };
  onClose: () => void;
  onSuspended: () => void;
}) {
  const { t } = useT();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real signal: orders currently routed to this depot (limit 1 → read total).
  const orders = useAsync<Page<Order>>(
    () => api.get(endpoints.orders.manage({ depotId: depot.id, limit: 1 }), true),
    [depot.id],
  );

  const matches = typed.trim() === depot.code;

  async function confirm() {
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(endpoints.depots.detail(depot.id), true);
      onSuspended();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.suspend.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={t('hq.suspend.title')}
    >
      <button
        type="button"
        aria-label={t('hq.suspend.cancel')}
        onClick={onClose}
        className="absolute inset-0 bg-[color:var(--text)]/40"
      />
      <div
        className="surface relative flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-3xl p-6 shadow-lift sm:max-w-md sm:rounded-3xl"
        style={{ animation: 'fadeUp 0.2s var(--ease-out) both' }}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--warning-bg)]">
            <Warning size={22} weight="fill" className="text-[color:var(--warning)]" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">{t('hq.suspend.title')}</h2>
            <p className="mt-0.5 text-sm text-muted">{t('hq.suspend.subtitle', { name: depot.name })}</p>
          </div>
        </div>

        {/* Impact preview */}
        <div className="flex flex-col gap-2 rounded-2xl bg-[color:var(--surface-soft)] p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t('hq.suspend.impact.title')}
          </p>
          <ul className="flex flex-col gap-2">
            <li className="flex items-start justify-between gap-3">
              <span>{t('hq.suspend.impact.orders')}</span>
              {orders.loading ? (
                <Skeleton className="h-4 w-8" />
              ) : (
                <span className="shrink-0 font-bold tabular-nums">{orders.data?.total ?? 0}</span>
              )}
            </li>
            <li className="flex items-start justify-between gap-3">
              <span>{t('hq.suspend.impact.staff')}</span>
              <Chip tone="amber">{t('hq.suspend.estimate')}</Chip>
            </li>
            <li className="flex items-start justify-between gap-3">
              <span>{t('hq.suspend.impact.coverage')}</span>
              <Chip tone="amber">{t('hq.suspend.estimate')}</Chip>
            </li>
          </ul>
        </div>

        {/* Typed-code guard */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="suspend-code" className="text-sm font-medium">
            {t('hq.suspend.guard.label', { code: depot.code })}
          </label>
          <Input
            id="suspend-code"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={depot.code}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={typed.length > 0 && !matches}
          />
        </div>

        {error && (
          <p className="text-sm text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('hq.suspend.cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={confirm} disabled={!matches} loading={busy}>
            {t('hq.suspend.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
