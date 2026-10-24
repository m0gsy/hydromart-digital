'use client';

import { Card } from '@/components/ui';
import { useT } from '@/lib/locale-context';

const ITEMS = ['dau', 'ltv', 'openRate', 'paySuccess', 'conversion', 'churn'] as const;

/** Metrics a reader may expect here that Hydromart has no source for: named, never estimated. */
export function UnavailableCard() {
  const { t } = useT();
  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">{t('insight.unavailable.title')}</h2>
      <p className="text-xs text-muted">{t('insight.unavailable.note')}</p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {ITEMS.map((k) => (
          <li
            key={k}
            className="rounded-full border border-[color:var(--border,#e9e7df)] px-3 py-1 text-xs text-muted"
          >
            {t(`insight.unavailable.items.${k}`)}
          </li>
        ))}
      </ul>
    </Card>
  );
}
