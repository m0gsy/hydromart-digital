'use client';

import { useState } from 'react';
import { Megaphone } from '@phosphor-icons/react';

import { Button, Card, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { StubBadge, stubSegmentEstimate } from '@/lib/hq/stubs';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

const inputClass =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm placeholder:text-[color:var(--text-muted)] focus:outline focus:outline-2 focus:outline-brand-600';

type Segment = 'all' | 'loyalty' | 'atRisk' | 'new';
const SEGMENTS: Segment[] = ['all', 'loyalty', 'atRisk', 'new'];
const STEPS = ['segment', 'message', 'send'] as const;

// Design 17c — campaign builder. Create is real (crm.createCampaign, same payload shape
// as dashboard/campaigns). The segment→recipient sizing has no endpoint → badged stub.
export default function HqCampaignBuilderPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [segment, setSegment] = useState<Segment>('all');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const estimate = stubSegmentEstimate(SEGMENTS.indexOf(segment));

  // Both "Send now" and "Schedule" create the campaign as a DRAFT (dispatch is a
  // separate sendCampaign step); the builder's job is the real create.
  async function create() {
    if (!name.trim()) return toast(t('hq.campaigns.needName'), 'error');
    if (!message.trim()) return toast(t('hq.campaigns.needMessage'), 'error');
    setBusy(true);
    try {
      // Loyalty maps to a concrete tier segment; the other presets target all customers.
      const seg = segment === 'loyalty' ? { tier: 'GOLD' } : {};
      await api.post(endpoints.crm.createCampaign, { name: name.trim(), messageTemplate: message, segment: seg }, true);
      toast(t('hq.campaigns.created'), 'success');
      setStep(0);
      setName('');
      setMessage('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.campaigns.error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Megaphone size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.campaigns.title')}</h1>
          <p className="text-sm text-muted">{t('hq.campaigns.subtitle')}</p>
        </div>
      </div>

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
            <div className="flex flex-wrap gap-2">
              {SEGMENTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSegment(s)}
                  aria-pressed={segment === s}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
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
                <StubBadge />
              </span>
              <span className="text-lg font-bold tabular-nums text-brand-700">
                {t('hq.campaigns.people', { n: estimate.toLocaleString('id-ID') })}
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
            <p><span className="text-muted">{t('hq.campaigns.segmentLabel')}:</span> <strong>{t(`hq.campaigns.chips.${segment}`)}</strong></p>
            <p><span className="text-muted">{t('hq.campaigns.nameLabel')}:</span> <strong>{name || '—'}</strong></p>
            <p className="whitespace-pre-wrap rounded-xl border border-app p-3 text-muted">{message || '—'}</p>
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
              <Button variant="secondary" onClick={create} loading={busy}>
                {t('hq.campaigns.schedule')}
              </Button>
              <Button onClick={create} loading={busy}>
                {t('hq.campaigns.sendNow')}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
