'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Sparkle } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Card } from '@/components/ui';
import { StubBadge } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 23b — first-run "Welcome to HQ" wizard. Progress is STUB local state (no setup-state
// endpoint — real backend track); every "Mulai" link is a REAL route into the setup screen.
const STEPS: { key: string; href: string; done: boolean }[] = [
  { key: 'twoFa', href: '/hq/security', done: true },
  { key: 'depot', href: '/hq/depots?onboard=1', done: false },
  { key: 'invite', href: '/hq/staff', done: false },
  { key: 'pricing', href: '/hq/tax', done: false },
  { key: 'payment', href: '/hq/payments', done: false },
];

export default function HqWizardPage() {
  const { t } = useT();
  const [steps] = useState(STEPS);
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Sparkle}
        title={t('hq.wizard.title')}
        subtitle={t('hq.wizard.subtitle')}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="brand">{t('hq.wizard.progress', { done, total: steps.length })}</Badge>
            <StubBadge />
          </div>
        }
      />

      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>

      {allDone && (
        <Card className="border-brand-400 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-800">{t('hq.wizard.allDone')}</p>
        </Card>
      )}

      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <Card key={s.key} className="flex items-center gap-3 p-4">
            <span
              className={
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                (s.done ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]' : 'bg-brand-50 text-brand-700')
              }
            >
              {s.done ? <Check size={16} weight="bold" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={'font-semibold ' + (s.done ? 'text-muted line-through' : '')}>
                {t(`hq.wizard.steps.${s.key}`)}
              </p>
              <p className="text-xs text-muted">{t(`hq.wizard.stepsBody.${s.key}`)}</p>
            </div>
            {s.done ? (
              <Badge tone="success">{t('hq.wizard.doneLabel')}</Badge>
            ) : (
              <Link
                href={s.href}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
              >
                {t('hq.wizard.start')}
                <ArrowRight size={14} weight="bold" />
              </Link>
            )}
          </Card>
        ))}
      </ol>
    </div>
  );
}
