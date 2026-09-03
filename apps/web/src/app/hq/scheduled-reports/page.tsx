'use client';

import { useState } from 'react';
import { CalendarCheck, Trash, WarningCircle } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import {
  Button,
  Card,
  ErrorState,
  Field,
  IconButton,
  Input,
  Skeleton,
  Toggle,
} from '@/components/ui';
import { Sheet, ConfirmDialog } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ExportFormat, ReportCadence, ReportDataset, ScheduledReport } from '@/lib/types';

// Design 15c — recurring scheduled reports. HEAD_OFFICE + SUPER_ADMIN CRUD; toggling
// `enabled` pauses a schedule without deleting it. `nextRunAt` is no longer advisory: the
// hourly sweep reads it, produces the file and records it in hq/exports.
//
// PDF is gone from the picker on purpose — there is no PDF renderer anywhere in this repo,
// and the server refuses the format rather than handing back an .xlsx under a .pdf name.
// Delivery is NOT email yet: there is no mail transport here, so the file is downloaded
// from hq/exports and the card says so rather than implying an inbox.
const CADENCES: ReportCadence[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
const FORMATS: ExportFormat[] = ['XLSX', 'CSV'];
const DATASETS: ReportDataset[] = ['REVENUE_BY_DEPOT', 'REVENUE_BY_PRODUCT', 'REVENUE_BY_METHOD'];

export default function HqScheduledReportsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<ScheduledReport[]>(() =>
    api.get(endpoints.admin.scheduledReports.list, true),
  );
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledReport | null>(null);
  const [busy, setBusy] = useState(false);

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error)
    return <ErrorState message={t('hq.scheduledReports.loadError')} onRetry={query.reload} />;

  const reports = query.data ?? [];

  async function toggle(r: ScheduledReport, enabled: boolean) {
    try {
      await api.patch(endpoints.admin.scheduledReports.update(r.id), { enabled }, true);
      toast(t('hq.scheduledReports.toggledOk', { name: r.name }), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.scheduledReports.saveError'), 'error');
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.del(endpoints.admin.scheduledReports.remove(deleteTarget.id), true);
      toast(t('hq.scheduledReports.deletedOk'), 'info');
      setDeleteTarget(null);
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.scheduledReports.saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={CalendarCheck}
        title={t('hq.scheduledReports.title')}
        subtitle={t('hq.scheduledReports.subtitle')}
        action={<Button onClick={() => setCreating(true)}>{t('hq.scheduledReports.add')}</Button>}
      />

      {reports.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.scheduledReports.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r) => (
            <Card
              key={r.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">{r.name}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t(`hq.scheduledReports.cadences.${r.cadence}`)} ·{' '}
                  {t(`hq.scheduledReports.datasets.${r.dataset}`)} · {r.format}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {t('hq.scheduledReports.nextRun')}:{' '}
                  {r.nextRunAt
                    ? new Date(r.nextRunAt).toLocaleString('id-ID')
                    : t('hq.scheduledReports.nextRunNone')}
                  {r.lastRunAt &&
                    ` · ${t('hq.scheduledReports.lastRun')}: ${new Date(r.lastRunAt).toLocaleString('id-ID')}`}
                </p>
                {/*
                  CA-2-66: a report that failed used to look exactly like one that worked.
                  The timestamp above is stamped either way, so head office set up a weekly
                  revenue report, saw it refresh every Monday, and had no way to learn the
                  file had not been produced for a month.
                */}
                {r.lastRunOk === false && (
                  <p
                    className="mt-1 flex items-start gap-1.5 text-xs font-semibold text-[color:var(--danger)]"
                    role="status"
                  >
                    <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                    <span>
                      {t('hq.scheduledReports.lastRunFailed')}
                      {r.lastError ? ` · ${r.lastError}` : ''}
                    </span>
                  </p>
                )}
                {/* Honest about the delivery gap: the file is produced and downloadable,
                    but nothing emails it, because this repo has no mail transport. */}
                <p className="mt-1 text-xs text-muted">{t('hq.scheduledReports.deliveryNote')}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-muted">
                  {r.enabled ? t('hq.scheduledReports.on') : t('hq.scheduledReports.off')}
                </span>
                <Toggle on={r.enabled} onChange={(v) => toggle(r, v)} label={r.name} />
                <IconButton
                  aria-label={t('hq.scheduledReports.delete')}
                  onClick={() => setDeleteTarget(r)}
                >
                  <Trash size={18} />
                </IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateReportSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          toast(t('hq.scheduledReports.addedOk'), 'success');
          query.reload();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('hq.scheduledReports.deleteTitle')}
        message={t('hq.scheduledReports.deleteMsg', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('hq.scheduledReports.delete')}
        cancelLabel={t('hq.common.cancel')}
        loading={busy}
        onConfirm={remove}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CreateReportSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState('');
  const [cadence, setCadence] = useState<ReportCadence>('DAILY');
  const [format, setFormat] = useState<ExportFormat>('XLSX');
  const [dataset, setDataset] = useState<ReportDataset>('REVENUE_BY_DEPOT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipientList = recipients
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = name.trim().length > 0 && recipientList.length > 0;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.admin.scheduledReports.create,
        { name: name.trim(), cadence, format, dataset, recipients: recipientList },
        true,
      );
      setName('');
      setRecipients('');
      setCadence('DAILY');
      setFormat('XLSX');
      setDataset('REVENUE_BY_DEPOT');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hq.scheduledReports.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('hq.scheduledReports.createTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('hq.scheduledReports.name')} htmlFor="sr-name">
          <Input
            id="sr-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('hq.scheduledReports.namePlaceholder')}
          />
        </Field>
        <Field
          label={t('hq.scheduledReports.recipients')}
          htmlFor="sr-recipients"
          hint={t('hq.scheduledReports.recipientsHint')}
        >
          <Input
            id="sr-recipients"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="finance@hydromart.id, ho@hydromart.id"
          />
        </Field>
        <Field label={t('hq.scheduledReports.cadence')}>
          <div className="flex overflow-hidden rounded-full border border-app text-xs font-bold">
            {CADENCES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCadence(c)}
                aria-pressed={cadence === c}
                className={`px-4 py-1.5 transition-colors ${cadence === c ? 'bg-brand-600 text-on-brand' : 'text-muted hover:bg-[color:var(--surface-soft)]'}`}
              >
                {t(`hq.scheduledReports.cadences.${c}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label={t('hq.scheduledReports.dataset')}
          htmlFor="sr-dataset"
          hint={t('hq.scheduledReports.datasetHint')}
        >
          <select
            id="sr-dataset"
            value={dataset}
            onChange={(e) => setDataset(e.target.value as ReportDataset)}
            className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
          >
            {DATASETS.map((d) => (
              <option key={d} value={d}>
                {t(`hq.scheduledReports.datasets.${d}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('hq.scheduledReports.format')}>
          <div className="flex overflow-hidden rounded-full border border-app text-xs font-bold">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                aria-pressed={format === f}
                className={`px-4 py-1.5 transition-colors ${format === f ? 'bg-brand-600 text-on-brand' : 'text-muted hover:bg-[color:var(--surface-soft)]'}`}
              >
                {f}
              </button>
            ))}
          </div>
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
            {t('hq.scheduledReports.add')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
