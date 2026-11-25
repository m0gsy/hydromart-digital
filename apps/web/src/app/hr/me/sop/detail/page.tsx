'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge, Button, Card, ErrorState, SectionHeader, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDate, formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { fetchPdf, type SopMineDetail } from '@/lib/sop';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

/** HD-16 — read one SOP version (text and/or PDF) and say "sudah dibaca". */
export default function MySopDetailPage() {
  const id = useQueryParam('id');
  const { t } = useT();
  const detail = useAsync<SopMineDetail>(() => api.get<SopMineDetail>(endpoints.hr.sopVersion(id), true), [id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const back = (
    <Link href="/hr/me/sop" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">
      {t('hrFix.mySop.back')}
    </Link>
  );
  if (detail.loading) return <Skeleton className="m-4 h-64" />;
  const v = detail.data;
  if (detail.error || !v) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-6">
        {back}
        <ErrorState message={t('hrFix.mySop.notFound')} onRetry={detail.reload} />
      </div>
    );
  }

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      await api.post(endpoints.hr.sopAck(id), {}, true);
      detail.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.mySop.ackFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function openPdf() {
    setError(null);
    try {
      await fetchPdf(id, v?.fileName ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.mySop.pdfFailed'));
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      {back}
      <SectionHeader
        title={v.sopTitle}
        subtitle={`${t('hrFix.mySop.versionLabel', { n: v.versionNo })} · ${t('hrFix.mySop.since', { date: formatDate(v.effectiveFrom) })}`}
      />
      <Card className="space-y-3 p-5">
        <Badge tone={v.acked ? 'success' : 'warning'}>{v.acked ? t('hrFix.mySop.read') : t('hrFix.mySop.unread')}</Badge>
        {v.body && <p className="whitespace-pre-line text-sm">{v.body}</p>}
        {v.hasFile && (
          <Button variant="secondary" onClick={openPdf}>
            {t('hrFix.mySop.openPdf')}
          </Button>
        )}
      </Card>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {v.acked && v.ackedAt ? (
        <p className="text-xs text-muted">{t('hrFix.mySop.ackedAt', { date: formatDateTime(v.ackedAt) })}</p>
      ) : (
        <Button onClick={acknowledge} loading={busy}>
          {t('hrFix.mySop.ack')}
        </Button>
      )}
    </div>
  );
}
