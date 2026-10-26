'use client';

import { useState } from 'react';
import { CalendarCheck, DownloadSimple, Trash, WarningCircle } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import {
  Badge,
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
import { api, ApiError, getBlob } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { filesFor, untilParts } from '@/lib/hq/scheduled-report';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  ExportFormat,
  ExportLogEntry,
  Page,
  ReportCadence,
  ReportDataset,
  ScheduledReport,
} from '@/lib/types';

// Design 15c — recurring scheduled reports. HEAD_OFFICE + SUPER_ADMIN CRUD; toggling
// `enabled` pauses a schedule without deleting it. `nextRunAt` is no longer advisory: the
// hourly sweep reads it, produces the file and records it in hq/exports.
//
// Delivery: the file is stored under hq/exports and, when admin-service has SMTP
// configured, mailed to the recipients as an attachment (best-effort, fail-open).
const CADENCES: ReportCadence[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
const FORMATS: ExportFormat[] = ['XLSX', 'CSV', 'PDF'];
const DATASETS: ReportDataset[] = [
  'REVENUE_BY_DEPOT',
  'REVENUE_BY_PRODUCT',
  'REVENUE_BY_METHOD',
  'ORDERS_DETAIL',
  'NEW_VS_REPEAT',
  'COD_UNSETTLED',
  'FAILED_DELIVERIES',
  'PROMO_COST',
  'KASBON_BALANCE',
  'STOCK_LEVELS',
  'METER_READINGS',
];

export default function HqScheduledReportsPage() {
  const { t, locale } = useT();
  const { toast } = useToast();
  const query = useAsync<ScheduledReport[]>(() =>
    api.get(endpoints.admin.scheduledReports.list, true),
  );
  // Best-effort: the cards are complete without it, so a failing log read costs the
  // "last file" line and nothing else.
  const logs = useAsync<Page<ExportLogEntry>>(() => api.get(endpoints.admin.exportLogsDone, true));
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledReport | null>(null);
  const [busy, setBusy] = useState(false);

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error)
    return <ErrorState message={t('hq.scheduledReports.loadError')} onRetry={query.reload} />;

  const reports = query.data ?? [];
  const active = reports.filter((r) => r.enabled).length;
  const failing = reports.filter((r) => r.enabled && r.lastRunOk === false).length;
  const soonest = reports
    .filter((r) => r.enabled && r.nextRunAt)
    .map((r) => r.nextRunAt as string)
    .sort()[0];
  const loggedFiles = logs.data?.items ?? [];

  async function download(id: string, fileName: string) {
    setFileBusy(id);
    try {
      downloadBlob(fileName, await getBlob(endpoints.admin.exportLogDownload(id)));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.exportsLog.downloadError'), 'error');
    } finally {
      setFileBusy(null);
    }
  }

  function nextIn(iso: string): string | null {
    const u = untilParts(iso);
    return u
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(u.value, u.unit)
      : null;
  }

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

      {reports.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-muted">{t('hq.scheduledReports.summaryActive')}</p>
            <p className="mt-1 text-2xl font-bold">
              {active}
              <span className="text-sm font-semibold text-muted"> / {reports.length}</span>
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">{t('hq.scheduledReports.summaryFailing')}</p>
            <p
              className={`mt-1 text-2xl font-bold ${failing > 0 ? 'text-[color:var(--danger)]' : ''}`}
            >
              {failing}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted">{t('hq.scheduledReports.summaryNext')}</p>
            <p className="mt-1 text-2xl font-bold">
              {(soonest && nextIn(soonest)) || t('hq.scheduledReports.nextRunNone')}
            </p>
          </Card>
        </div>
      )}

      {reports.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.scheduledReports.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r) => {
            const lastFile = filesFor(r, loggedFiles)[0];
            const relNext = r.enabled && r.nextRunAt ? nextIn(r.nextRunAt) : null;
            return (
              <Card
                key={r.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{r.name}</p>
                    {!r.enabled ? (
                      <Badge>{t('hq.scheduledReports.off')}</Badge>
                    ) : r.lastRunOk === false ? (
                      <Badge tone="danger">{t('hq.scheduledReports.statusFailed')}</Badge>
                    ) : r.lastRunOk ? (
                      <Badge tone="success">{t('hq.scheduledReports.statusOk')}</Badge>
                    ) : (
                      <Badge tone="warning">{t('hq.scheduledReports.statusNever')}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {t(`hq.scheduledReports.cadences.${r.cadence}`)} ·{' '}
                    {t(`hq.scheduledReports.datasets.${r.dataset}`)} · {r.format}
                    {` · ${t(`hq.scheduledReports.covers.${r.cadence}`)}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t('hq.scheduledReports.nextRun')}:{' '}
                    {r.nextRunAt
                      ? new Date(r.nextRunAt).toLocaleString('id-ID')
                      : t('hq.scheduledReports.nextRunNone')}
                    {relNext && ` (${relNext})`}
                    {r.lastRunAt &&
                      ` · ${t('hq.scheduledReports.lastRun')}: ${new Date(r.lastRunAt).toLocaleString('id-ID')}`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">
                      {t('hq.scheduledReports.sentTo', { n: r.recipients.length })}
                    </span>
                    {r.recipients.map((email) => (
                      <span
                        key={email}
                        className="rounded-full bg-[color:var(--surface-muted)] px-2 py-0.5 text-xs"
                      >
                        {email}
                      </span>
                    ))}
                  </div>
                  {lastFile?.fileName && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="text-muted">{t('hq.scheduledReports.lastFile')}:</span>
                      <button
                        type="button"
                        onClick={() => download(lastFile.id, lastFile.fileName as string)}
                        disabled={fileBusy === lastFile.id}
                        className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline disabled:opacity-60"
                      >
                        <DownloadSimple size={14} />
                        {lastFile.fileName}
                      </button>
                      {lastFile.rowCount !== null && (
                        <span className="text-muted">
                          {t('hq.scheduledReports.rows', { n: lastFile.rowCount })}
                        </span>
                      )}
                    </p>
                  )}
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
            );
          })}
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
