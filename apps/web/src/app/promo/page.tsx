'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, Clock, Copy, Tag } from '@phosphor-icons/react';

import { ProductCard } from '@/components/product-card';
import { Card, CenterState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useMemberRate } from '@/lib/member';
import { useAsync } from '@/lib/use-async';
import type { Page, Product, Promotion } from '@/lib/types';

// A short promo strip; the full catalog lives at /products (the "Lihat semua" link).
const PROMO_PRODUCT_LIMIT = 4;

// Date-only badge label ("31 Jul 2026"). id-ID matches the rupiah/formatDateTime
// convention in lib/format.ts (this page is Indonesia-only customer-facing).
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Remaining {
  ended: boolean;
  days: number;
  hours: number;
  mins: number;
  secs: number;
}

// Live d/h/m/s countdown to `target`. `now` starts null so SSR and the first
// client render agree (no hydration mismatch); the interval fills it in on mount.
function useCountdown(target: string | null): Remaining | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target || now == null) return null;
  const diff = Math.max(0, new Date(target).getTime() - now);
  return {
    ended: diff === 0,
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff / 3_600_000) % 24),
    mins: Math.floor((diff / 60_000) % 60),
    secs: Math.floor((diff / 1000) % 60),
  };
}

function CountdownBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-[62px] flex-col items-center rounded-xl bg-white/15 px-2 py-2">
      <span className="text-[22px] font-extrabold leading-none tabular-nums">{String(value).padStart(2, '0')}</span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/70">{label}</span>
    </div>
  );
}

function VoucherCard({ promo }: { promo: Promotion }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const code = promo.voucherCode!;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (insecure context / denied) — no-op, code stays visible to copy by hand */
    }
  }

  return (
    <div className="surface relative rounded-2xl border-[1.5px] border-dashed border-app p-[18px]">
      <div className="text-[15px] font-extrabold tracking-[-0.01em]">{promo.title}</div>
      {promo.subtitle && (
        <div className="mt-1 min-h-[34px] text-[12.5px] leading-snug text-muted">{promo.subtitle}</div>
      )}
      <button
        type="button"
        onClick={copy}
        className="mt-3 flex w-full items-center justify-between gap-2.5 rounded-[10px] bg-brand-50 px-3 py-2.5 text-left"
      >
        <span className="font-mono text-sm font-extrabold tracking-[0.04em] text-brand-800">{code}</span>
        <span className="flex items-center gap-1.5 text-xs font-extrabold text-brand-600">
          {copied ? <CheckCircle size={14} weight="fill" /> : <Copy size={14} weight="bold" />}
          {copied ? t('customerFix.promo.copied') : t('customerFix.promo.copy')}
        </span>
      </button>
    </div>
  );
}

export default function PromoPage() {
  const { t } = useT();
  const memberRate = useMemberRate();

  // Public active-promo feed (active + within date window, sorted). Fail-soft: on
  // error we fall through to the fallback hero + empty voucher note, never a dead end.
  const { data: promos, loading } = useAsync<Promotion[]>(() => api.get<Promotion[]>(endpoints.promotions.list), []);

  // ponytail: no promo-tagged product endpoint exists, so the strip just shows the
  // active catalog head. Swap to a promo-scoped query when the backend grows one.
  const { data: productPage } = useAsync<Page<Product>>(
    () => api.get<Page<Product>>(endpoints.products.browse({ page: 1, limit: PROMO_PRODUCT_LIMIT })),
    [],
  );

  const hero = promos?.[0] ?? null;
  const vouchers = (promos ?? []).filter((p) => p.voucherCode);
  const products = productPage?.items ?? [];

  const countdown = useCountdown(hero?.endsAt ?? null);
  const title = hero?.title ?? t('customerFix.promo.heroFallbackTitle');
  const subtitle = hero?.subtitle ?? t('customerFix.promo.heroFallbackSubtitle');
  const shopHref = hero?.ctaHref || '/products';
  const terms = [
    t('customerFix.promo.term1'),
    t('customerFix.promo.term2'),
    t('customerFix.promo.term3'),
    t('customerFix.promo.term4'),
  ];

  if (loading && !promos) return <Skeleton className="h-[420px] w-full rounded-3xl" />;

  return (
    <div className="flex flex-col gap-8">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 to-brand-600 p-8 text-on-brand sm:p-11">
        <div className="pointer-events-none absolute -right-8 -top-10 h-52 w-52 rounded-full bg-white/[0.08]" />
        <div className="pointer-events-none absolute -bottom-16 right-28 h-40 w-40 rounded-full bg-white/[0.06]" />
        <div className="relative flex flex-col">
          {hero?.endsAt && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold">
              <Clock size={14} weight="fill" />
              {t('customerFix.promo.heroBadgeEnds', { date: formatDay(hero.endsAt) })}
            </span>
          )}
          <h1 className="mt-4 max-w-xl text-[32px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[38px]">
            {title}
          </h1>
          <p className="mt-2.5 max-w-lg text-[15px] leading-relaxed text-white/85">{subtitle}</p>

          {/* Countdown — only when the hero promo has an end date */}
          {hero?.endsAt && (
            <div className="mt-6">
              {countdown?.ended ? (
                <span className="text-sm font-extrabold text-white/90">{t('customerFix.promo.ended')}</span>
              ) : (
                <>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/70">
                    {t('customerFix.promo.endsIn')}
                  </div>
                  <div className="flex gap-2.5">
                    <CountdownBox value={countdown?.days ?? 0} label={t('customerFix.promo.dayLabel')} />
                    <CountdownBox value={countdown?.hours ?? 0} label={t('customerFix.promo.hourLabel')} />
                    <CountdownBox value={countdown?.mins ?? 0} label={t('customerFix.promo.minLabel')} />
                    <CountdownBox value={countdown?.secs ?? 0} label={t('customerFix.promo.secLabel')} />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href={shopHref}
              className="flex h-12 items-center rounded-xl bg-white px-6 text-[14.5px] font-extrabold text-brand-800 transition-transform hover:scale-[1.02]"
            >
              {t('customerFix.promo.shopPromo')}
            </Link>
            <a
              href="#terms"
              className="flex h-12 items-center rounded-xl border border-white/40 px-6 text-[14.5px] font-extrabold text-on-brand transition-colors hover:bg-white/10"
            >
              {t('customerFix.promo.terms')}
            </a>
          </div>
        </div>
      </div>

      {/* VOUCHER CODES */}
      <section>
        <h2 className="mb-3.5 text-lg font-extrabold tracking-[-0.02em]">{t('customerFix.promo.claimVouchers')}</h2>
        {vouchers.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vouchers.map((p) => (
              <VoucherCard key={p.id} promo={p} />
            ))}
          </div>
        ) : (
          <CenterState icon={<Tag size={44} weight="thin" />} title={t('customerFix.promo.empty')} />
        )}
      </section>

      {/* PROMO PRODUCTS */}
      {products.length > 0 && (
        <section>
          <div className="mb-3.5 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-[-0.02em]">{t('customerFix.promo.promoProducts')}</h2>
            <Link href="/products" className="text-[13px] font-bold text-brand-600 hover:text-brand-700">
              {t('customerFix.promo.viewAll')}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} memberRate={memberRate} badge={t('customerFix.promo.badge')} />
            ))}
          </div>
        </section>
      )}

      {/* TERMS */}
      <section id="terms" className="scroll-mt-20">
        <Card className="p-6">
          <h2 className="text-[15px] font-extrabold">{t('customerFix.promo.terms')}</h2>
          <ul className="mt-3.5 flex flex-col gap-2.5">
            {terms.map((term, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-muted">
                <CheckCircle size={17} weight="fill" className="mt-0.5 flex-none text-brand-600" />
                {term}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
