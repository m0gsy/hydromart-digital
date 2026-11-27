'use client';

import Link from 'next/link';
import { Phone } from '@phosphor-icons/react';

import { Badge, Card } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { labelKey, STATUS_TONE } from '@/lib/prospect-labels';
import type { ProspectRow } from '@/lib/types';

/**
 * One card per prospect: a card stacks to 320 px by itself, so there is no second wide layout to
 * keep in step. Phone and contact never appear (the list DTO has none); `hasPhone` is only an icon.
 */
export function ProspectTable({
  rows,
  depotCode,
  assigneeLabel,
  linkable,
}: {
  rows: ProspectRow[];
  depotCode: (id: string | null) => string;
  assigneeLabel: (id: string | null) => string;
  /** Only a Work holder may open a row (GET /:id is Work). */
  linkable: boolean;
}) {
  const { t } = useT();
  return (
    <ul className="flex flex-col gap-2" aria-label={t('opsFix.prospects.title')}>
      {rows.map((r) => (
        <li key={r.id}>
          <Card className="flex flex-col gap-1.5 p-3.5" elevated={false}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              {linkable ? (
                <Link
                  href={`/dashboard/prospects/detail?id=${r.id}`}
                  className="text-sm font-semibold text-brand-700"
                >
                  {r.name}
                </Link>
              ) : (
                <span className="text-sm font-semibold">{r.name}</span>
              )}
              <Badge tone={STATUS_TONE[r.status]}>{t(labelKey('status', r.status))}</Badge>
            </div>
            <p className="text-xs text-muted">
              {t(labelKey('category', r.category))}
              {r.kecamatanCode ? ` / ${r.kecamatanCode}` : ''}
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-muted">{t('opsFix.prospects.cols.depot')}</dt>
                <dd>{depotCode(r.ownerDepotId)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('opsFix.prospects.cols.assignee')}</dt>
                <dd>{assigneeLabel(r.assignedToId)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('opsFix.prospects.cols.age')}</dt>
                <dd>{formatDate(r.sourceDate ?? r.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('opsFix.prospects.cols.phone')}</dt>
                <dd>
                  <Phone
                    size={16}
                    aria-label={r.hasPhone ? t('opsFix.prospects.hasPhone') : t('opsFix.prospects.noPhone')}
                    className={r.hasPhone ? '' : 'opacity-30'}
                  />
                </dd>
              </div>
            </dl>
          </Card>
        </li>
      ))}
    </ul>
  );
}
