'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';

import { SopVersionForm } from '@/components/hq/sop-version-form';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { fetchAllDepots } from '@/lib/all-depots';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { audienceLabel, type SopDetail, type SopUnreadPage, type SopVersionDetail } from '@/lib/sop';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

const PAGE_SIZE = 50;

/** HD-16 — one SOP: its version history, and for each version who has not read it yet. */
export default function HqSopDetailPage() {
  const id = useQueryParam('id');
  const { t } = useT();
  const { customer } = useAuth();
  const [adding, setAdding] = useState(false);
  const detail = useAsync<SopDetail>(() => api.get(endpoints.hr.sop(id), true), [id]);
  // Names for the per-depot counts; best effort, an id prefix stands in when the directory is down.
  const depots = useAsync(() => fetchAllDepots().catch(() => []), []);
  const depotName = new Map((depots.data ?? []).map((d) => [d.id, `${d.code} · ${d.name}`]));

  if (detail.loading) return <Skeleton className="h-96 w-full" />;
  const sop = detail.data;
  const back = (
    <Link href="/hq/sop" className="tap-44 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
      <ArrowLeft size={16} weight="bold" /> {t('hq.sop.back')}
    </Link>
  );
  if (detail.error || !sop) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <ErrorState message={t('hq.sop.notFound')} onRetry={detail.reload} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{sop.title}</h1>
        {can('sopManage', customer?.role) && <Button onClick={() => setAdding(true)}>{t('hq.sop.addVersion')}</Button>}
      </div>

      <h2 className="text-lg font-semibold">{t('hq.sop.versions')}</h2>
      <ol className="flex flex-col gap-3">
        {sop.versions.map((v) => (
          <VersionCard key={v.id} version={v} depotName={depotName} />
        ))}
      </ol>

      {adding && (
        <SopVersionForm
          open
          sopId={sop.id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            detail.reload();
          }}
        />
      )}
    </div>
  );
}

function VersionCard({ version: v, depotName }: { version: SopVersionDetail; depotName: Map<string, string> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{t('hq.sop.versionLabel', { n: v.versionNo })}</Badge>
          <span className="font-semibold">{v.title}</span>
        </div>
        <p className="text-xs text-muted">
          {t('hq.sop.since')} {formatDate(v.effectiveFrom)} · {audienceLabel(v, t)}
        </p>
        <p className="text-sm">
          {t('hq.sop.readOf', { read: v.ackCount, total: v.audienceSize })}
          {v.unread > 0 ? ` · ${t('hq.sop.unread', { n: v.unread })}` : ` · ${t('hq.sop.allRead')}`}
        </p>
        {v.hasFile && (
          <p className="text-xs text-muted">
            {t('hq.sop.file')}: {v.fileName}
          </p>
        )}
        {v.body && <p className="line-clamp-4 whitespace-pre-line text-sm">{v.body}</p>}
        <div>
          <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? t('hq.sop.hideUnread') : t('hq.sop.showUnread')}
          </Button>
        </div>
        {open && <UnreadList versionId={v.id} depotName={depotName} />}
      </Card>
    </li>
  );
}

/** Pages through the people who still have to read one version; names come in pages of 50. */
function UnreadList({ versionId, depotName }: { versionId: string; depotName: Map<string, string> }) {
  const { t } = useT();
  const [pages, setPages] = useState<SopUnreadPage[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = useAsync<SopUnreadPage>(
    () =>
      api.get<SopUnreadPage>(endpoints.hr.sopUnread(versionId, { page: 1, pageSize: PAGE_SIZE }), true).then((p) => {
        setPages([p]);
        return p;
      }),
    [versionId],
  );

  const shown = pages.reduce((n, p) => n + p.items.length, 0);
  const head = pages[0];

  async function more() {
    setBusy(true);
    setFailed(false);
    try {
      const next = await api.get<SopUnreadPage>(
        endpoints.hr.sopUnread(versionId, { page: pages.length + 1, pageSize: PAGE_SIZE }),
        true,
      );
      setPages((prev) => [...prev, next]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (first.loading) return <Skeleton className="h-24 w-full" />;
  if (first.error || !head) return <ErrorState message={t('hq.sop.unreadError')} onRetry={first.reload} />;
  if (head.unreadTotal === 0) return <p className="text-sm text-muted">{t('hq.sop.unreadEmpty')}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold text-muted">{t('hq.sop.unreadByDepot')}</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {head.byDepot.map((d) => (
            <li key={d.depotId ?? 'none'}>
              <Badge tone="warning">
                {d.depotId ? (depotName.get(d.depotId) ?? d.depotId.slice(0, 8)) : t('hq.sop.noDepot')} · {d.unread}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
        {pages.flatMap((p) => p.items).map((e) => (
          <li key={e.employeeId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="font-medium">{e.fullName}</span>
            <span className="text-xs text-muted">
              {e.employeeCode} · {e.position}
            </span>
          </li>
        ))}
      </ul>
      {failed && (
        <p className="text-sm text-[color:var(--danger)]" role="alert">
          {t('hq.sop.unreadError')}
        </p>
      )}
      {shown < head.unreadTotal && (
        <div>
          <Button variant="secondary" onClick={more} loading={busy}>
            {t('hq.sop.more')}
          </Button>
        </div>
      )}
    </div>
  );
}
