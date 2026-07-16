'use client';

import Link from 'next/link';
import { SquaresFour } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { HQ_GROUPS } from '@/components/hq/hq-rail';
import { Card } from '@/components/ui';
import { useT } from '@/lib/locale-context';

// Design 11a — HQ screen index. Real: generated from HQ_GROUPS (the single nav model), so it
// always mirrors the actual routes. Only ready screens are listed; click to jump.
export default function HqSitemapPage() {
  const { t } = useT();
  const groups = HQ_GROUPS.map((g) => ({ headKey: g.headKey, items: g.items.filter((i) => i.ready) })).filter(
    (g) => g.items.length > 0,
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={SquaresFour}
        title={t('hq.sitemap.title')}
        subtitle={t('hq.sitemap.subtitle')}
        action={<span className="text-sm font-semibold text-muted">{t('hq.sitemap.count', { n: total })}</span>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.headKey} className="flex flex-col gap-1 p-4">
            <p className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted">
              {t(`hq.groups.${g.headKey}`)}
            </p>
            {g.items.map((i) => {
              const Ic = i.icon;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors hover:bg-[color:var(--surface-soft)]"
                >
                  <Ic size={17} weight="fill" className="text-brand-500" />
                  {t(`hq.nav.${i.labelKey}`)}
                </Link>
              );
            })}
          </Card>
        ))}
      </div>
    </div>
  );
}
