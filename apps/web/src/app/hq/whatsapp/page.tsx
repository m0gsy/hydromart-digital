'use client';

import { useState } from 'react';
import { WhatsappLogo } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { HqPageHeader } from '@/components/hq/page-header';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { WaOverview, WaTemplateStatus } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

const STATUSES: WaTemplateStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAUSED'];
const STATE_TONE = { ON: 'success', OFF: 'neutral', PAUSED: 'warning', INCOMPLETE: 'warning' } as const;

type Row = WaOverview['categories'][number];

/** `''` is "not filled in" (null on the server); anything else must be a number or the field is refused. */
const money = (v: string): number | null | undefined => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Used against cap: amber from 80 %, red at 100 %. No cap row means nothing can be sent. */
function Usage({ row }: { row: Row }) {
  const { t } = useT();
  const cap = row.monthlyMessages;
  const pct = cap ? Math.min(100, Math.round((row.messages / cap) * 100)) : 0;
  const color = !cap ? 'var(--border)' : pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
  return (
    <div className="flex min-w-[8rem] flex-col gap-1">
      <span className="text-sm tabular-nums">
        {row.messages} / {cap ?? t('wa.hq.noCap')}
      </span>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function CapForm({ row, editable, onSaved }: { row: Row; editable: boolean; onSaved: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const [cap, setCap] = useState(row.monthlyMessages?.toString() ?? '');
  const [rate, setRate] = useState(row.rateIdr?.toString() ?? '');
  const [costCap, setCostCap] = useState(row.monthlyCostIdr?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const capNum = Number(cap);
  const rateNum = money(rate);
  const costNum = money(costCap);
  const valid = cap.trim() !== '' && Number.isInteger(capNum) && capNum >= 0 && rateNum !== undefined && costNum !== undefined;

  async function save() {
    setSaving(true);
    try {
      await api.put(
        endpoints.whatsapp.hqCap(row.category),
        { monthlyMessages: capNum, rateIdr: rateNum, monthlyCostIdr: costNum },
        true,
      );
      toast(t('wa.hq.saved'), 'success');
      onSaved();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('wa.hq.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <Field label={t('wa.hq.capLabel')} htmlFor={`wa-cap-${row.category}`}>
        <Input
          id={`wa-cap-${row.category}`}
          inputMode="numeric"
          value={cap}
          disabled={!editable}
          onChange={(e) => setCap(e.target.value)}
        />
      </Field>
      <Field label={t('wa.hq.rateLabel')} htmlFor={`wa-rate-${row.category}`} hint={t('wa.hq.rateHint')}>
        <Input
          id={`wa-rate-${row.category}`}
          inputMode="decimal"
          value={rate}
          disabled={!editable}
          onChange={(e) => setRate(e.target.value)}
        />
      </Field>
      <Field label={t('wa.hq.costCapLabel')} htmlFor={`wa-costcap-${row.category}`}>
        <Input
          id={`wa-costcap-${row.category}`}
          inputMode="decimal"
          value={costCap}
          disabled={!editable}
          onChange={(e) => setCostCap(e.target.value)}
        />
      </Field>
      {editable && (
        <div className="sm:col-span-3">
          <Button loading={saving} disabled={!valid} onClick={() => void save()}>
            {t('wa.hq.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function HqWhatsappPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { customer } = useAuth();
  const editable = can('waManage', customer?.role);
  const query = useAsync<WaOverview>(() => api.get(endpoints.whatsapp.hqOverview, true));
  const [busy, setBusy] = useState(false);

  async function setPaused(paused: boolean) {
    if (paused) {
      const ok = await confirm({
        title: t('wa.hq.pauseAll'),
        message: t('wa.hq.pauseConfirm'),
        confirmLabel: t('wa.hq.pauseAll'),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api.post(endpoints.whatsapp.hqPause, { paused }, true);
      toast(t(paused ? 'wa.hq.paused' : 'wa.hq.resumed'), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('wa.hq.pauseError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setTemplate(name: string, language: string, status: string) {
    try {
      await api.put(endpoints.whatsapp.hqTemplates, { name, language, status }, true);
      toast(t('wa.hq.saved'), 'success');
      query.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('wa.hq.saveError'), 'error');
    }
  }

  if (query.loading && !query.data) return <Skeleton className="h-96 w-full" />;
  if (query.error || !query.data) return <ErrorState message={t('wa.hq.loadError')} onRetry={query.reload} />;

  const o = query.data;
  const rowKey = (r: Row) => `${r.category}:${r.monthlyMessages ?? ''}:${r.rateIdr ?? ''}:${r.monthlyCostIdr ?? ''}`;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={WhatsappLogo} title={t('wa.hq.title')} subtitle={t('wa.hq.subtitle')} />

      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={STATE_TONE[o.state]}>{t(`wa.hq.state.${o.state}`)}</Badge>
        {o.state === 'INCOMPLETE' && o.missing.length > 0 && (
          <span className="text-sm text-muted">{t('wa.hq.missing', { keys: o.missing.join(', ') })}</span>
        )}
        {editable && (
          <Button
            variant={o.state === 'PAUSED' ? 'secondary' : 'danger'}
            loading={busy}
            onClick={() => void setPaused(o.state !== 'PAUSED')}
          >
            {o.state === 'PAUSED' ? t('wa.hq.resume') : t('wa.hq.pauseAll')}
          </Button>
        )}
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-semibold">{t('wa.hq.usageTitle', { month: o.month })}</h2>
        {o.categories.map((row) => (
          <div key={row.category} className="border-t border-app pt-4 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold">{t(`wa.hq.category.${row.category}`)}</span>
              <Usage row={row} />
              <span className="text-sm tabular-nums">
                {t('wa.hq.cost')}: {row.costIdr === null ? t('wa.hq.noRate') : formatIDR(row.costIdr)}
              </span>
            </div>
            <CapForm key={rowKey(row)} row={row} editable={editable} onSaved={query.reload} />
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">{t('wa.hq.templatesTitle')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="py-2 pr-3">{t('wa.hq.tplEvent')}</th>
                <th className="py-2 pr-3">{t('wa.hq.tplName')}</th>
                <th className="py-2 pr-3">{t('wa.hq.tplStatus')}</th>
                <th className="py-2">{t('wa.hq.tplReason')}</th>
              </tr>
            </thead>
            <tbody>
              {o.templates.map((tpl) => (
                <tr key={tpl.id} className="border-t border-app">
                  <td className="py-2 pr-3">{tpl.event ?? '-'}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{tpl.name}</td>
                  <td className="py-2 pr-3">
                    {editable ? (
                      <select
                        aria-label={t('wa.hq.tplStatusLabel', { name: tpl.name })}
                        className="surface-elevated rounded-lg border border-app px-2 py-1.5 text-sm"
                        value={tpl.status}
                        onChange={(e) => void setTemplate(tpl.name, tpl.language, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(`wa.hq.tplStatuses.${s}`)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      t(`wa.hq.tplStatuses.${tpl.status}`)
                    )}
                  </td>
                  <td className="py-2 text-muted">{tpl.statusReason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-5">
        <h2 className="font-semibold">{t('wa.hq.problemsTitle')}</h2>
        {o.problems.length === 0 ? (
          <p className="text-sm text-muted">{t('wa.hq.problemsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)] text-sm">
            {o.problems.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-mono text-xs">{p.templateName}</span>
                <span>{p.skipReason ? t(`wa.hq.skip.${p.skipReason}`) : p.status}</span>
                <span className="text-xs text-muted">{p.createdAt}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
