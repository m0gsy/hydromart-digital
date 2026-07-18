'use client';

import Link from 'next/link';
import { ArrowLeft, Tag, Clock } from '@phosphor-icons/react';

import { ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import type { Promotion } from '@/lib/types';

// ponytail: inline ID copy (app is ID-primary); wire useT keys when EN parity matters.
function PromoInner() {
  const { data, error, loading, reload } = useAsync<Promotion[]>(() =>
    api.get(endpoints.promotions.list),
  );

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Beranda"
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight">Promo</h1>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <div
          className="rounded-2xl border border-app p-8 text-center text-sm text-muted"
          style={{ background: 'var(--surface-muted)' }}
        >
          Belum ada promo aktif. Cek lagi nanti.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {data.map((p) => (
            <PromoCard key={p.id} promo={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PromoCard({ promo }: { promo: Promotion }) {
  const cta = (
    <span className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-6 text-sm font-extrabold text-white transition-colors hover:bg-brand-700">
      {promo.ctaLabel ?? 'Belanja promo'}
    </span>
  );
  return (
    <div className="surface relative overflow-hidden rounded-[20px] border border-app p-6">
      {promo.endsAt && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[11px] font-extrabold text-brand-700">
          <Clock size={13} weight="fill" />
          Berakhir {formatDateTime(promo.endsAt).split(',')[0]}
        </span>
      )}
      <div className="mt-3 text-[22px] font-extrabold leading-tight tracking-tight">{promo.title}</div>
      {promo.subtitle && <div className="mt-1.5 text-sm text-muted">{promo.subtitle}</div>}

      {promo.voucherCode && (
        <div className="mt-4 flex items-center gap-2">
          <Tag size={16} weight="fill" className="text-brand-600" />
          <code className="rounded-lg border border-dashed border-app px-3 py-1.5 font-mono text-sm font-bold tracking-wide">
            {promo.voucherCode}
          </code>
        </div>
      )}

      <div className="mt-5">
        {promo.ctaHref ? <Link href={promo.ctaHref}>{cta}</Link> : <Link href="/products">{cta}</Link>}
      </div>
    </div>
  );
}

export default function PromoPage() {
  // Public — promotions feed needs no auth.
  return <PromoInner />;
}
