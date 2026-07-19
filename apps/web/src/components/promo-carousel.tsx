'use client';

import Link from 'next/link';
import { useState } from 'react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Promotion } from '@/lib/types';

// Home promo duo (public promo feed). A discovery surface: renders nothing while
// loading, on error, or when empty — never blocks the page. The first promo is a
// deep-teal card whose CTA copies its voucher code; the second is an amber card
// whose CTA links to the shop.

function CodePill({ code, teal }: { code: string; teal: boolean }) {
  return (
    <span
      className={
        teal
          ? 'rounded-[10px] border-[1.5px] border-dashed border-white/45 px-3.5 py-1.5 font-mono text-[13px] font-bold tracking-[0.08em]'
          : 'rounded-[10px] border-[1.5px] border-dashed border-[rgba(122,90,15,0.4)] px-3.5 py-1.5 font-mono text-[13px] font-bold tracking-[0.08em] text-[#5c3d05] dark:text-[color:var(--warning)]'
      }
    >
      {code}
    </span>
  );
}

function TealCard({ promo }: { promo: Promotion }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!promo.voucherCode) return;
    try {
      await navigator.clipboard.writeText(promo.voucherCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <div className="bg-deep-teal flex h-full flex-col justify-between gap-5 rounded-[22px] p-7 text-white shadow-card">
      <div>
        <h3 className="text-[22px] font-extrabold tracking-tight">{promo.title}</h3>
        {promo.subtitle && <p className="mt-1.5 text-sm text-white/75">{promo.subtitle}</p>}
      </div>
      {promo.voucherCode && (
        <div className="flex items-center gap-3">
          <CodePill code={promo.voucherCode} teal />
          <button
            onClick={copy}
            className="inline-flex rounded-full bg-white px-[18px] py-[9px] text-[13.5px] font-extrabold text-deep-teal transition-transform hover:scale-[1.03]"
          >
            {copied ? t('home.promo.copied') : t('home.promo.copyCode')}
          </button>
        </div>
      )}
    </div>
  );
}

function AmberCard({ promo }: { promo: Promotion }) {
  const { t } = useT();
  return (
    <div className="flex h-full flex-col justify-between gap-5 rounded-[22px] bg-amber-50 p-7 shadow-card">
      <div>
        <h3 className="text-[22px] font-extrabold tracking-tight text-[#3e2a02] dark:text-[color:var(--warning)]">
          {promo.title}
        </h3>
        {promo.subtitle && (
          <p className="mt-1.5 text-sm text-[#8a6a1f] dark:text-[color:var(--warning)]">{promo.subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {promo.voucherCode && <CodePill code={promo.voucherCode} teal={false} />}
        <Link
          href={promo.ctaHref || '/products'}
          className="inline-flex rounded-full bg-amber-600 px-[18px] py-[9px] text-[13.5px] font-extrabold text-white transition-transform hover:scale-[1.03]"
        >
          {promo.ctaLabel || t('home.promo.shopNow')}
        </Link>
      </div>
    </div>
  );
}

export function PromoCarousel() {
  const { t } = useT();
  const { data, loading, error } = useAsync<Promotion[]>(
    () => api.get<Promotion[]>(endpoints.promotions.list),
    [],
  );

  const first = data?.[0];
  if (loading || error || !first) return null;
  const second = data[1];

  return (
    <section className="flex flex-col gap-3" aria-label={t('home.promo.aria')}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TealCard promo={first} />
        {second && <AmberCard promo={second} />}
      </div>
      {/* ponytail: only link out when the carousel doesn't already show every promo */}
      {data.length > 2 && (
        <Link href="/promo" className="self-end text-sm font-extrabold text-brand-700 hover:underline">
          {t('home.promo.seeAll')}
        </Link>
      )}
    </section>
  );
}
