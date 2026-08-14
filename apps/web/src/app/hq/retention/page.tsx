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

// Design 19e — retention windows per dataset + backup status. Real admin-service track:
// GET /retention returns { policies, backup }; PUT /retention/:id edits one window.
// H-37: backup and restore-drill status are now WRITTEN by the VPS cron jobs
// (backup-db.sh / restore-db.sh --drill), so this card reports what actually happened
// instead of the "NONE" it could only ever show before.

/** OK is green, FAILED is red, never-run stays neutral — a failure must not read as calm. */
function backupTone(status: string): 'success' | 'danger' | 'neutral' {
  if (status === 'OK') return 'success';
  if (status === 'FAILED') return 'danger';
  return 'neutral';
}

export default function HqRetentionPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<RetentionOverview>(() => api.get(endpoints.admin.retention.list, true));
  const [editing, setEditing] = useState<RetentionPolicy | null>(null);
  const [sweeping, setSweeping] = useState(false);

  /**
   * Runs the policy now. The result names every dataset with no executor, so a sweep that
   * deleted nothing is distinguishable from a policy nobody enforces — the exact confusion
   * this page used to create by showing windows that never applied.
   */
  async function runSweep() {
    setSweeping(true);
    try {
      const result = await api.post<{ totalDeleted: number; unenforced: string[] }>(
        endpoints.admin.retention.purge(),
        {},
        true,
      );
      toast(
        t('hq.retention.sweepDone', {
          n: String(result.totalDeleted),
          gaps: String(result.unenforced.length),
        }),
        'success',
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.retention.sweepError'), 'error');
    } finally {
      setSweeping(false);
    }
  }

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error)
    return <ErrorState message={t('hq.retention.loadError')} onRetry={query.reload} />;

  const { policies, backup } = query.data!;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Archive}
        title={t('hq.retention.title')}
        subtitle={t('hq.retention.subtitle')}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button loading={sweeping} onClick={runSweep}>
          {t('hq.retention.runSweep')}
        </Button>
        <span className="text-xs text-muted">{t('hq.retention.sweepHint')}</span>
      </div>

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
                <td className="px-4 py-2.5 font-semibold">
                  {/* Two vocabularies name the same things here — the seeded rows carry `pesanan` and
                      `log_audit` alongside `orders_transactions` and `audit_logs`. The dictionary
                      carries both, and an unknown dataset falls back to its own name: a raw
                      `hq.retention.datasets.x` on screen tells the reader nothing. */}
                  {t(`hq.retention.datasets.${r.dataset}`) === `hq.retention.datasets.${r.dataset}`
                    ? r.dataset
                    : t(`hq.retention.datasets.${r.dataset}`)}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {r.windowLabel}
                  {/* M23-21: financial data survives every purge — say so where it is edited. */}
                  {r.purgeExempt && (
                    <span className="ml-2 rounded-full bg-[color:var(--surface-soft)] px-2 py-0.5 text-[11px] font-bold text-brand-700">
                      {t('hq.retention.exempt')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted">
                  {t('hq.retention.dayCount', { n: r.windowDays })}
                </td>
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
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  {t('hq.retention.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* H-37: both verdicts are written by the cron jobs on the VPS (backup-db.sh and
          restore-db.sh). FAILED is shown as loudly as OK — a card that can only ever say
          "no engine wired" is what let a broken backup look the same as a working one. */}
      <Card className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-extrabold">{t('hq.retention.backupTitle')}</p>
          <Badge tone={backupTone(backup.status)}>
            {backup.status === 'NONE' ? t('hq.retention.backupNone') : backup.status}
          </Badge>
        </div>
        <p className="text-sm text-muted">
          {t('hq.retention.lastBackup')}:{' '}
          {backup.lastBackupAt ? new Date(backup.lastBackupAt).toLocaleString('id-ID') : '—'}
          {backup.detail ? ` · ${backup.detail}` : ''}
        </p>

        <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
          <p className="text-sm font-extrabold">{t('hq.retention.drillTitle')}</p>
          <Badge tone={backupTone(backup.drillStatus)}>
            {backup.drillStatus === 'NONE' ? t('hq.retention.drillNone') : backup.drillStatus}
          </Badge>
        </div>
        <p className="text-sm text-muted">
          {t('hq.retention.lastDrill')}:{' '}
          {backup.lastDrillAt ? new Date(backup.lastDrillAt).toLocaleString('id-ID') : '—'}
          {backup.drillDetail ? ` · ${backup.drillDetail}` : ''}
        </p>
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
      await api.put(
        endpoints.admin.retention.update(policy.id),
        { windowLabel: label.trim(), windowDays: daysNum },
        true,
      );
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
        <Field
          label={t('hq.retention.window')}
          htmlFor="ret-label"
          hint={t('hq.retention.windowHint')}
        >
          <Input
            id="ret-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('hrFix.retention.yearsHint')}
          />
        </Field>
        <Field label={t('hq.retention.days')} htmlFor="ret-days">
          <Input
            id="ret-days"
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        {error && (
          <p className="text-sm text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('hq.common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!valid} loading={busy}>
            {t('hq.retention.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
