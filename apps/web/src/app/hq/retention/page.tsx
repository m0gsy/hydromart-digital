'use client';

import { useState } from 'react';
import { Archive } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { RetentionOverview, RetentionPolicy } from '@/lib/types';

// Design 19e — retention windows per dataset + read-only backup status. Real admin-service
// track: GET /retention returns { policies, backup }; PUT /retention/:id edits one window.
// Backup status has NO engine wired, so it is labeled honestly (never a fake "success").
export default function HqRetentionPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<RetentionOverview>(() => api.get(endpoints.admin.retention.list, true));
  const [editing, setEditing] = useState<RetentionPolicy | null>(null);

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error) return <ErrorState message={t('hq.retention.loadError')} onRetry={query.reload} />;

  const { policies, backup } = query.data!;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Archive} title={t('hq.retention.title')} subtitle={t('hq.retention.subtitle')} />

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-app text-left text-xs font-medium uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">{t('hq.retention.dataset')}</th>
              <th className="px-4 py-2.5">{t('hq.retention.window')}</th>
              <th className="px-4 py-2.5">{t('hq.retention.days')}</th>
              <th className="px-4 py-2.5 text-right">{t('hq.retention.action')}</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((r) => (
              <tr key={r.id} className="border-b border-app last:border-0">
                <td className="px-4 py-2.5 font-semibold">{t(`hq.retention.datasets.${r.dataset}`)}</td>
                <td className="px-4 py-2.5 text-muted">{r.windowLabel}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted">{t('hq.retention.dayCount', { n: r.windowDays })}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-[color:var(--surface-soft)]"
                  >
                    {t('hq.retention.edit')}
                  </button>
                </td>
              </tr>
            ))}
            {policies.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">{t('hq.retention.empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-extrabold">{t('hq.retention.backupTitle')}</p>
          <Badge tone={backup.status === 'NONE' ? 'neutral' : 'success'}>
            {backup.status === 'NONE' ? t('hq.retention.backupNone') : backup.status}
          </Badge>
        </div>
        <p className="text-sm text-muted">
          {t('hq.retention.lastBackup')}:{' '}
          {backup.lastBackupAt ? new Date(backup.lastBackupAt).toLocaleString('id-ID') : '—'}
        </p>
        {/* Honest: there is no backup engine wired in admin-service — the status is stored & shown as-is. */}
        <p className="text-xs text-muted">{t('hq.retention.backupNote')}</p>
      </Card>

      <EditWindowSheet
        policy={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          toast(t('hq.retention.savedOk'), 'success');
          query.reload();
        }}
      />
    </div>
  );
}

function EditWindowSheet({
  policy,
  onClose,
  onSaved,
}: {
  policy: RetentionPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form each time a policy is opened.
  const [seededId, setSeededId] = useState<string | null>(null);
  if (policy && policy.id !== seededId) {
    setSeededId(policy.id);
    setLabel(policy.windowLabel);
    setDays(String(policy.windowDays));
    setError(null);
  }

  const daysNum = Number(days);
  const valid = label.trim().length > 0 && Number.isInteger(daysNum) && daysNum >= 1;

  async function submit() {
    if (!policy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(endpoints.admin.retention.update(policy.id), { windowLabel: label.trim(), windowDays: daysNum }, true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.retention.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={policy !== null} onClose={onClose} title={t('hq.retention.editTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('hq.retention.window')} htmlFor="ret-label" hint={t('hq.retention.windowHint')}>
          <Input id="ret-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="7 tahun (UU PDP)" />
        </Field>
        <Field label={t('hq.retention.days')} htmlFor="ret-days">
          <Input id="ret-days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-[color:var(--danger)]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('hq.common.cancel')}</Button>
          <Button onClick={submit} disabled={!valid} loading={busy}>{t('hq.retention.save')}</Button>
        </div>
      </div>
    </Sheet>
  );
}
