'use client';

import Link from 'next/link';
import { CheckCircle, HandWaving, ChartLineUp, Lock, Tag, type Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isDepotManager } from '@/lib/roles';

const DUTIES: { icon: Icon; titleKey: string; descKey: string }[] = [
  { icon: CheckCircle, titleKey: 'dashB.onboarding.duty1Title', descKey: 'dashB.onboarding.duty1Desc' },
  { icon: Tag, titleKey: 'dashB.onboarding.duty2Title', descKey: 'dashB.onboarding.duty2Desc' },
  { icon: ChartLineUp, titleKey: 'dashB.onboarding.duty3Title', descKey: 'dashB.onboarding.duty3Desc' },
];

function OnboardingBody() {
  const { t } = useT();
  const { customer } = useAuth();

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <Card elevated className="flex flex-col items-center gap-3 bg-brand-700 p-8 text-center text-on-brand">
        <span className="flex size-16 items-center justify-center rounded-full bg-white/15">
          <HandWaving size={34} weight="fill" />
        </span>
        <h1 className="text-2xl font-bold">{t('dashB.onboarding.welcome', { name: customer?.fullName ?? t('dashB.onboarding.managerFallback') })}</h1>
        <p className="text-sm text-white/85">
          {t('dashB.onboarding.intro')}
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        {DUTIES.map((d) => {
          const DIcon = d.icon;
          return (
            <Card key={d.titleKey} className="flex items-start gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <DIcon size={22} weight="fill" />
              </span>
              <div>
                <p className="font-semibold">{t(d.titleKey)}</p>
                <p className="text-[12.5px] text-[color:var(--text-muted)]">{t(d.descKey)}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2" aria-hidden="true">
        <span className="size-2 rounded-full bg-brand-600" />
        <span className="size-2 rounded-full bg-brand-200" />
        <span className="size-2 rounded-full bg-brand-200" />
      </div>

      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="flex-1 rounded-lg border border-app px-4 py-2.5 text-center text-sm font-semibold text-[color:var(--text-muted)]"
        >
          {t('dashB.onboarding.skip')}
        </Link>
        <Link
          href="/dashboard"
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-on-brand hover:bg-brand-700"
        >
          {t('dashB.onboarding.startTour')}
        </Link>
      </div>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title={t('dashB.onboarding.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.onboarding.gateBody')}
      </CenterState>
    );
  }
  return <OnboardingBody />;
}

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
