'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileText } from '@phosphor-icons/react';

import { SopVersionForm } from '@/components/hq/sop-version-form';
import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { audienceLabel, type SopSummary } from '@/lib/sop';
import { useAsync } from '@/lib/use-async';

/**
 * HD-16 — the SOP list: each procedure with the version in force, who it covers and how many have
 * read it. Reading needs `sopRead`; writing a new SOP needs `sopManage`.
 */
export default function HqSopPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const [creating, setCreating] = useState(false);
  const list = useAsync<SopSummary[]>(() => api.get(endpoints.hr.sops, true), []);
  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={FileText}
        title={t('hq.sop.title')}
        subtitle={t('hq.sop.subtitle')}
        action={
          can('sopManage', customer?.role) ? <Button onClick={() => setCreating(true)}>{t('hq.sop.add')}</Button> : undefined
        }
      />

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={t('hq.sop.loadError')} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.sop.empty')}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((sop) => (
            <li key={sop.id}>
              <Card className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{sop.title}</p>
                    <p className="text-xs text-muted">{t('hq.sop.versionCount', { n: sop.versionCount })}</p>
                  </div>
                  <Link
                    href={`/hq/sop/detail?id=${sop.id}`}
                    className="tap-44 inline-flex items-center text-sm font-semibold text-brand-700"
                  >
                    {t('hq.sop.detail')}
                  </Link>
                </div>
                {sop.current ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="brand">
                      {t('hq.sop.inForce')}: {t('hq.sop.versionLabel', { n: sop.current.versionNo })}
                    </Badge>
                    <span className="text-muted">
                      {t('hq.sop.since')} {formatDate(sop.current.effectiveFrom)} · {audienceLabel(sop.current, t)}
                    </span>
                    <span>{t('hq.sop.readOf', { read: sop.current.ackCount, total: sop.current.audienceSize })}</span>
                    {sop.current.unread > 0 ? (
                      <Badge tone="warning">{t('hq.sop.unread', { n: sop.current.unread })}</Badge>
                    ) : (
                      <Badge tone="success">{t('hq.sop.allRead')}</Badge>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted">{t('hq.sop.noneInForce')}</p>
                )}
                {sop.upcoming && (
                  <p className="text-xs text-muted">
                    {t('hq.sop.upcoming')}: {t('hq.sop.versionLabel', { n: sop.upcoming.versionNo })} · {t('hq.sop.since')}{' '}
                    {formatDate(sop.upcoming.effectiveFrom)}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <SopVersionForm
          open
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
    </div>
  );
}
