'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Sparkle } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { OnboardingState, OnboardingStep } from '@/lib/types';

// Design 23b — first-run "Welcome to HQ" wizard. Step completion is REAL admin-service track:
// GET /onboarding reflects state; PATCH { step, done } persists it. Each "Mulai" link is a
// REAL route into the setup screen; "Tandai selesai" marks the step done.
const STEPS: { key: OnboardingStep; href: string }[] = [
  { key: 'verify2fa', href: '/hq/security' },
  { key: 'addDepot', href: '/hq/depots?onboard=1' },
  { key: 'inviteHeadOffice', href: '/hq/staff' },
  { key: 'setPricingTax', href: '/hq/tax' },
  { key: 'enablePayments', href: '/hq/payments' },
];

export default function HqWizardPage() {
  const { t } = useT();
  const { toast } = useToast();
  const query = useAsync<OnboardingState>(() => api.get(endpoints.admin.wizard, true));
  const [state, setState] = useState<OnboardingState | null>(null);
  const [busy, setBusy] = useState<OnboardingStep | null>(null);

  if (query.loading) return <Skeleton className="h-96 w-full" />;
  if (query.error) return <ErrorState message={t('hq.wizard.loadError')} onRetry={query.reload} />;

  const s = state ?? query.data!;
  const done = STEPS.filter((step) => s[step.key]).length;
  const allDone = done === STEPS.length;

  async function mark(step: OnboardingStep, done: boolean) {
    setBusy(step);
    try {
      const saved = await api.patch<OnboardingState>(endpoints.admin.wizard, { step, done }, true);
      setState(saved);
      toast(done ? t('hq.wizard.markedDone') : t('hq.wizard.markedTodo'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.wizard.saveError'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Sparkle}
        title={t('hq.wizard.title')}
        subtitle={t('hq.wizard.subtitle')}
        action={<Badge tone="brand">{t('hq.wizard.progress', { done, total: STEPS.length })}</Badge>}
      />

      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${(done / STEPS.length) * 100}%` }} />
      </div>

      {allDone && (
        <Card className="border-brand-400 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-800">{t('hq.wizard.allDone')}</p>
        </Card>
      )}

      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => {
          const isDone = s[step.key];
          return (
            <Card key={step.key} className="flex items-center gap-3 p-4">
              <span
                className={
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                  (isDone ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]' : 'bg-brand-50 text-brand-700')
                }
              >
                {isDone ? <Check size={16} weight="bold" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={'font-semibold ' + (isDone ? 'text-muted line-through' : '')}>
                  {t(`hq.wizard.steps.${step.key}`)}
                </p>
                <p className="text-xs text-muted">{t(`hq.wizard.stepsBody.${step.key}`)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isDone ? (
                  <button
                    type="button"
                    disabled={busy === step.key}
                    onClick={() => mark(step.key, false)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-[color:var(--surface-soft)] disabled:opacity-60"
                  >
                    {t('hq.wizard.undo')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy === step.key}
                      onClick={() => mark(step.key, true)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-[color:var(--surface-soft)] disabled:opacity-60"
                    >
                      {t('hq.wizard.markDone')}
                    </button>
                    <Link
                      href={step.href}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
                    >
                      {t('hq.wizard.start')}
                      <ArrowRight size={14} weight="bold" />
                    </Link>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </ol>
    </div>
  );
}
