'use client';

import { Clock, Drop, ShieldCheck, Wallet } from '@phosphor-icons/react';

import { useT } from '@/lib/locale-context';

// Real, defensible trust signals — not testimonials. No customer data / no
// fabricated quotes: just the guarantees and payment options the platform
// actually offers. Static content, localized.

const SIGNALS = [
  { icon: Clock, title: 'home.trust.fastTitle', body: 'home.trust.fastBody' },
  { icon: Drop, title: 'home.trust.sealedTitle', body: 'home.trust.sealedBody' },
  { icon: ShieldCheck, title: 'home.trust.payTitle', body: 'home.trust.payBody' },
  { icon: Wallet, title: 'home.trust.methodsTitle', body: 'home.trust.methodsBody' },
] as const;

export function TrustIndicators() {
  const { t } = useT();
  return (
    <section className="flex flex-col gap-2" aria-label={t('home.trust.aria')}>
      <h2 className="text-lg font-bold">{t('home.trust.title')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SIGNALS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="surface flex flex-col gap-2 rounded-xl border border-app p-4">
              <Icon size={24} weight="fill" className="text-brand-600" />
              <h3 className="font-semibold">{t(s.title)}</h3>
              <p className="text-sm text-muted">{t(s.body)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
