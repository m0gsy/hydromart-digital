'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Megaphone } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

type Segment = 'all' | 'loyalty' | 'atRisk' | 'new';
const SEGMENTS: Segment[] = ['all', 'loyalty', 'atRisk', 'new'];
const STEPS = ['segment', 'message', 'send'] as const;

// Each preset maps to activity conditions the order-service segment-estimate endpoint
// honours (frequency / lapsed-recency / first-order recency). `all` = every reachable
// customer. Tier isn't joinable here, so "loyalty" is a frequency proxy (≥5 orders).
const SEGMENT_CONDITIONS: Record<Segment, { minOrders?: number; lapsedDays?: number; newWithinDays?: number }> = {
  all: {},
  loyalty: { minOrders: 5 },
  atRisk: { lapsedDays: 60 },
  new: { newWithinDays: 30 },
};

// Design 17c — campaign builder. The estimate and the send now use ONE segment: the same
// `SEGMENT_CONDITIONS[segment]` that sizes the audience is what the campaign is created
// with. They used to disagree — the chip was sized from order-service activity while the
// POST sent `{tier:'GOLD'}` or `{}` (= everyone) — and neither button sent at all: "Kirim
// sekarang" and "Jadwalkan" both only drafted.
export default function HqCampaignBuilderPage() {
  const { t } = useT();
  const { toast } = useToast();
  const params = useSearchParams();
  const [step, setStep] = useState(0);
  const [segment, setSegment] = useState<Segment>('all');

  /**
   * Conditions handed over by the segment builder (`/hq/forms/segment` → "Pakai di
   * campaign"). That screen has always appended them to the URL; this one never read them,
   * so the whole handoff ended at a builder that quietly started from "all customers"
   * again. When they are present they REPLACE the chip preset — the operator picked those
   * conditions on the previous screen, and a chip silently overriding them would be the
   * same disagreement between what is shown and what is sent, one screen over.
   */
  const handoff = useMemo(() => {
    const num = (k: string): number | undefined => {
      const n = Number.parseInt(params.get(k) ?? '', 10);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };
    const q = {
      recencyDays: num('recencyDays'),
      minOrders: num('minOrders'),
      depotId: params.get('depotId') ?? undefined,
    };
    const used = Object.values(q).some((v) => v != null);
    return used ? q : null;
  }, [params]);

  const conditions = handoff ?? SEGMENT_CONDITIONS[segment];
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [busy, setBusy] = useState(false);

  const estimateQ = useAsync<{ count: number }>(
    () => api.get(endpoints.segments.estimate(conditions), true),
    [JSON.stringify(conditions)],
  );
  const estimate = estimateQ.data?.count ?? 0;

  /**
   * Create AND queue. A draft nobody dispatches is a button that promises a send and does
   * not send; the claim is a separate call because dispatch runs on the sweep (B-17), not
   * inside this request. A scheduled campaign is claimed now and becomes due later.
   */
  async function create(schedule: boolean) {
    if (!name.trim()) return toast(t('hq.campaigns.needName'), 'error');
    if (!message.trim()) return toast(t('hq.campaigns.needMessage'), 'error');
    if (schedule && !scheduledFor) return toast(t('hq.campaigns.needSchedule'), 'error');
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>(
        endpoints.crm.createCampaign,
        {
          name: name.trim(),
          messageTemplate: message,
          // The same conditions the estimate above showed. Anything else and the number on
          // screen belongs to a different audience than the one being messaged.
          segment: conditions,
          ...(schedule ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
        },
        true,
      );
      await api.post(endpoints.crm.sendCampaign(created.id), undefined, true);
      toast(t(schedule ? 'hq.campaigns.scheduled' : 'hq.campaigns.sent'), 'success');
      setStep(0);
      setName('');
      setMessage('');
      setScheduledFor('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.campaigns.error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <HqPageHeader icon={Megaphone} title={t('hq.campaigns.title')} subtitle={t('hq.campaigns.subtitle')} />

      {/* Stepper */}
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                i <= step ? 'bg-brand-600 text-on-brand' : 'bg-[color:var(--surface-muted)] text-muted'
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm font-semibold ${i === step ? '' : 'text-muted'}`}>
              {t(`hq.campaigns.steps.${s}`)}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-[color:var(--border)]" />}
          </li>
        ))}
      </ol>

      <Card className="flex flex-col gap-4 p-5">
        {step === 0 && (
          <>
            <span className="text-sm font-medium">{t('hq.campaigns.segmentLabel')}</span>
            {handoff && (
              <p className="rounded-xl border border-app bg-brand-50 px-3.5 py-2.5 text-xs text-brand-800">
                {t('hq.campaigns.fromSegmentBuilder')}
              </p>
            )}
            <div className={`flex flex-wrap gap-2 ${handoff ? 'opacity-40' : ''}`}>
              {SEGMENTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={handoff !== null}
                  onClick={() => setSegment(s)}
                  aria-pressed={handoff === null && segment === s}
                  className={`min-h-11 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    segment === s ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-app text-muted hover:bg-[color:var(--surface-soft)]'
                  }`}
                >
                  {t(`hq.campaigns.chips.${s}`)}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-app p-3">
              <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
                {t('hq.campaigns.estimate')}
              </span>
              <span className="text-lg font-bold tabular-nums text-brand-700">
                {/* "0 orang" is a decision to not send. An unread estimate is not zero. */}
                {estimateQ.loading
                  ? '…'
                  : estimateQ.error
                    ? t('hq.common.dash')
                    : t('hq.campaigns.people', { n: estimate.toLocaleString('id-ID') })}
              </span>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <Field label={t('hq.campaigns.nameLabel')} htmlFor="c-name">
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('hq.campaigns.namePh')} />
            </Field>
            <Field label={t('hq.campaigns.messageLabel')} htmlFor="c-msg">
              <textarea
                id="c-msg"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className={inputClass}
                placeholder={t('hq.campaigns.messagePh')}
              />
            </Field>
          </>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <span className="text-muted">{t('hq.campaigns.segmentLabel')}:</span>{' '}
              <strong>{handoff ? t('hq.campaigns.fromSegmentBuilder') : t(`hq.campaigns.chips.${segment}`)}</strong>
            </p>
            <p><span className="text-muted">{t('hq.campaigns.nameLabel')}:</span> <strong>{name || '—'}</strong></p>
            <p className="whitespace-pre-wrap rounded-xl border border-app p-3 text-muted">{message || '—'}</p>
            <Field label={t('hq.campaigns.scheduleLabel')} htmlFor="c-when" hint={t('hq.campaigns.scheduleHint')}>
              <Input
                id="c-when"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </Field>
          </div>
        )}

        <div className="flex justify-between gap-2 border-t border-app pt-3">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            {t('hq.campaigns.back')}
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep((s) => s + 1)}>{t('hq.campaigns.next')}</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => create(true)} loading={busy}>
                {t('hq.campaigns.schedule')}
              </Button>
              <Button onClick={() => create(false)} loading={busy}>
                {t('hq.campaigns.sendNow')}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
