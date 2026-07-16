'use client';

import Link from 'next/link';
import { ArrowRight, Check, ListChecks } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card } from '@/components/ui';
import { ONBOARDING_STEPS_STUB } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 15d — depot go-live checklist. No onboarding-workflow service, so steps are
// stubbed; the "provision" step link is a REAL handoff to the depot onboard form.
export default function HqOnboardingPage() {
  const { t } = useT();
  const steps = ONBOARDING_STEPS_STUB;
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={ListChecks}
        title={t('hq.onboarding.title')}
        subtitle={t('hq.onboarding.subtitle')}
        stub
        action={<Badge tone="brand">{t('hq.onboarding.progress', { done, total: steps.length })}</Badge>}
      />

      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <Card key={s.id} className="flex items-center gap-3 p-4">
            <span
              className={
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                (s.done ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]' : 'bg-[color:var(--surface-soft)] text-muted')
              }
            >
              {s.done ? <Check size={16} weight="bold" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={'font-semibold ' + (s.done ? 'text-muted line-through' : '')}>{s.label}</p>
              <p className="text-xs text-muted">{s.owner}</p>
            </div>
            {s.done ? (
              <Badge tone="success">{t('hq.onboarding.done')}</Badge>
            ) : s.href ? (
              <Link
                href={s.href}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
              >
                {t('hq.onboarding.open')}
                <ArrowRight size={14} weight="bold" />
              </Link>
            ) : (
              <Badge tone="neutral">{t('hq.onboarding.todo')}</Badge>
            )}
          </Card>
        ))}
      </ol>

      <p className="text-xs text-muted">{t('hq.onboarding.provisionHint')}</p>
    </div>
  );
}
