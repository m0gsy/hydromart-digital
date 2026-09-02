'use client';

import { useState } from 'react';
import { ShieldCheck, Warning } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { Button, Card, Chip, ErrorState, Skeleton } from '@/components/ui';
import { ConfirmDialog } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { pdpDeadline, pdpOverdue } from '@/lib/pdp-sla';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ConsentLagReport, DataSubjectRequest } from '@/lib/types';

/**
 * UU PDP tahap 1 (item 13) — the head-office decision queue.
 *
 * An approved EXPORT returns the payload once, in the response. It is offered as a
 * download and then dropped: keeping a copy of everything we hold about a person, on a
 * console page, would create the second copy the request exists to avoid.
 */
export default function HqPdpPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { askReason } = useConfirm();
  const [onlyPending, setOnlyPending] = useState(true);
  const { data, error, loading, reload } = useAsync<DataSubjectRequest[]>(
    () => api.get(endpoints.pdp.queue(onlyPending ? 'PENDING' : undefined), true),
    [onlyPending],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DataSubjectRequest | null>(null);

  async function approve(row: DataSubjectRequest) {
    setBusy(row.id);
    try {
      const result = await api.post<{ export?: unknown }>(endpoints.pdp.approve(row.id), {}, true);
      if (result.export) {
        downloadBlob(
          `pdp-export-${row.customerId}.json`,
          new Blob([JSON.stringify(result.export, null, 2)], { type: 'application/json' }),
        );
        toast(t('hq.pdp.exportReady'), 'success');
      } else {
        toast(t('hq.pdp.approved'), 'success');
      }
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.pdp.actionError'), 'error');
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  }

  async function reject(row: DataSubjectRequest) {
    // A refusal without a reason tells the customer nothing, and the API refuses it too —
    // so the box is required and the button stays disabled until it has something in it.
    const reason = await askReason({
      title: t('hq.pdp.reject'),
      message: t('hq.pdp.rejectPrompt'),
      label: t('hq.pdp.reason'),
      confirmLabel: t('hq.pdp.reject'),
    });
    if (!reason) return;
    setBusy(row.id);
    try {
      await api.post(endpoints.pdp.reject(row.id), { reason }, true);
      toast(t('hq.pdp.rejected'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.pdp.actionError'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.pdp.title')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">{t('hq.pdp.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant={onlyPending ? 'primary' : 'secondary'} onClick={() => setOnlyPending(true)}>
            {t('hq.pdp.filterPending')}
          </Button>
          <Button variant={onlyPending ? 'secondary' : 'primary'} onClick={() => setOnlyPending(false)}>
            {t('hq.pdp.filterAll')}
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-[color:var(--text-muted)]">
          {t('hq.pdp.empty')}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.map((row) => (
            <li key={row.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t(`hq.pdp.type.${row.type}`)}</span>
                    <Chip tone="outline">{t(`hq.pdp.status.${row.status}`)}</Chip>
                  </div>
                  <div className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                    {t('hq.pdp.customer')} {row.customerName ?? row.customerId.slice(0, 8)} ·{' '}
                    {t('hq.pdp.requestedAt')}{' '}
                    {formatDateTime(row.requestedAt)}
                  </div>
                  {/*
                    K1.6. The customer is now told they get an answer within 3x24 hours. This
                    is the screen where somebody can still make that true, so it is the screen
                    that has to say when the clock runs out — and say it loudly once it has.
                  */}
                  {row.status === 'PENDING' && (
                    <div
                      className={`mt-0.5 text-xs ${
                        pdpOverdue(row.requestedAt, row.status)
                          ? 'font-semibold text-[color:var(--danger)]'
                          : 'text-[color:var(--text-muted)]'
                      }`}
                    >
                      {pdpOverdue(row.requestedAt, row.status)
                        ? t('hq.pdp.overdue')
                        : t('hq.pdp.dueBy', {
                            date: formatDateTime(pdpDeadline(row.requestedAt).toISOString()),
                          })}
                    </div>
                  )}
                  {row.reason && (
                    <div className="mt-1 text-xs text-[color:var(--text-muted)]">
                      {t('hq.pdp.reason')}: {row.reason}
                    </div>
                  )}
                </div>
                {row.status === 'PENDING' && (
                  // CA-2-62: `loading` disables the button it is on and nothing else, so
                  // while an approval was in flight the Reject beside it stayed live —
                  // two opposite decisions on one request, racing, and whichever answered
                  // last is what the customer is told. Both lock while either runs.
                  <div className="flex gap-2">
                    <Button
                      loading={busy === row.id}
                      disabled={busy !== null}
                      onClick={() => (row.type === 'DELETE' ? setConfirmDelete(row) : approve(row))}
                    >
                      {t('hq.pdp.approve')}
                    </Button>
                    <Button variant="secondary" disabled={busy !== null} onClick={() => reject(row)}>
                      {t('hq.pdp.reject')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConsentLagCard />

      <p className="flex items-start gap-2 rounded-xl bg-[color:var(--surface-soft)] px-4 py-3 text-xs text-[color:var(--text-muted)]">
        <Warning size={16} weight="fill" className="mt-0.5 flex-shrink-0" />
        {t('hq.pdp.deleteWarning')}
      </p>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('hq.pdp.approve')}
        message={t('hq.pdp.deleteWarning')}
        confirmLabel={t('hq.pdp.approve')}
        loading={busy !== null}
        onConfirm={() => confirmDelete && approve(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

/** Page size. The server caps a page at 100; 25 is what fits on a screen without scrolling
 *  past the totals, which are the part of this report anybody actually reads. */
const LAG_PAGE_SIZE = 25;

/**
 * W10 — the fleet-wide half of "who is still behind the Terms/Privacy text in force".
 *
 * Three things this has to get right, and each of them is a way to make the number lie:
 *
 *  1. The totals do NOT sum. Only `current` is exclusive; neverAsked/refused/outdated
 *     overlap, so one account can be counted in two of them. Rendered as separate figures
 *     with that said in words — a pie or a stacked bar here would silently claim a whole
 *     that does not exist.
 *  2. Nearly everybody is `outdated` on day one, because the consent-ledger migration
 *     backfilled every existing row at version '1.0'. That is the correct answer, so it is
 *     shown in a neutral tone with the reason beside it. Painted red it would read as an
 *     incident and get "fixed" by re-prompting the entire customer base.
 *  3. "Never asked" is not "refused". The ledger keeps them apart on purpose (no row at
 *     all vs. a row that says no) and this screen keeps them apart too.
 *
 * Paged by keyset, forward-only by nature: each page hands back the cursor for the next.
 * "Back" is therefore the stack of cursors already spent, not a page number the server
 * never had. Unpaged was the alternative and this walks the entire customer base.
 */
function ConsentLagCard() {
  const { t } = useT();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const { data, error, loading, reload } = useAsync<ConsentLagReport>(
    () => api.get(endpoints.pdp.consentReport({ limit: LAG_PAGE_SIZE, cursor }), true),
    [cursor],
  );

  const totals = data?.totals;
  const figures = totals
    ? ([
        ['population', totals.population],
        ['current', totals.current],
        ['neverAsked', totals.neverAsked],
        ['refused', totals.refused],
        ['outdated', totals.outdated],
      ] as const)
    : [];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-lg font-bold">{t('hq.consentLag.title')}</h2>
        <p className="text-sm text-[color:var(--text-muted)]">{t('hq.consentLag.subtitle')}</p>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorState message={t('hq.consentLag.loadError')} onRetry={reload} />
      ) : (
        <>
          <p className="text-xs text-[color:var(--text-muted)]">
            {t('hq.consentLag.version', { v: data?.documentVersion ?? '' })}
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {figures.map(([key, value]) => (
              <div key={key} className="rounded-xl border border-app px-3 py-2">
                <div className="text-xs text-[color:var(--text-muted)]">
                  {t(`hq.consentLag.${key}`)}
                </div>
                <div className="text-lg font-bold">{value}</div>
              </div>
            ))}
          </div>

          <p className="text-xs text-[color:var(--text-muted)]">{t('hq.consentLag.overlapNote')}</p>
          <p className="text-xs text-[color:var(--text-muted)]">{t('hq.consentLag.backfillNote')}</p>
          <p className="text-xs text-[color:var(--text-muted)]">
            {t('hq.consentLag.neverAskedNote')}
          </p>

          {(data?.items ?? []).length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">{t('hq.consentLag.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(data?.items ?? []).map((row) => (
                <li
                  key={row.customerId}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-app px-3 py-2 text-xs"
                >
                  {/* Id only — the server sends no name or phone, and a compliance count is
                      not a reason to build a second identified roster of the customer base. */}
                  <span className="font-mono font-semibold">{row.customerId.slice(0, 8)}</span>
                  {row.neverAsked.map((p) => (
                    <Chip key={`n-${p}`} tone="outline">
                      {t('hq.consentLag.neverAsked')}: {t(`account.consents.purpose.${p}`)}
                    </Chip>
                  ))}
                  {row.refused.map((p) => (
                    <Chip key={`r-${p}`} tone="amber">
                      {t('hq.consentLag.refused')}: {t(`account.consents.purpose.${p}`)}
                    </Chip>
                  ))}
                  {row.outdated.map((p) => (
                    <Chip key={`o-${p}`} tone="tint">
                      {t('hq.consentLag.outdated')}: {t(`account.consents.purpose.${p}`)}
                    </Chip>
                  ))}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={cursors.length === 0}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              {t('hq.consentLag.prev')}
            </Button>
            <Button
              variant="secondary"
              disabled={!data?.nextCursor}
              onClick={() =>
                setCursors((c) => (data?.nextCursor ? [...c, data.nextCursor] : c))
              }
            >
              {t('hq.consentLag.next')}
            </Button>
            <span className="text-xs text-[color:var(--text-muted)]">
              {t('hq.consentLag.page', { n: String(cursors.length + 1) })}
              {!data?.nextCursor && ` · ${t('hq.consentLag.lastPage')}`}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
