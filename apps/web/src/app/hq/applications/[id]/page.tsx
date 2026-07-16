'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Check, DotsThree, X } from '@phosphor-icons/react';

import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  ApproveApplicationResult,
  ChecklistItem,
  ChecklistItemStatus,
  FranchiseApplication,
  FranchiseAppStage,
} from '@/lib/types';
import type { DepotForm } from '@/lib/depots';

/** Whole days since submission = SLA age. */
function ageDays(submittedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86_400_000));
}

// Design 5b — application detail (real depot-service track). Checklist items PATCH their
// status; "Approve & provision" POSTs approve, stashes the returned proposed-depot
// prefill, then hands off to the real depot onboard form (/hq/depots?onboard=1).
const CHECKLIST: ChecklistItem[] = ['ktpNpwp', 'locationProof', 'capitalDeposit', 'fieldSurvey'];
const EDITABLE_STAGES: FranchiseAppStage[] = ['PENDING', 'DOC_VERIFICATION', 'SURVEY'];
// Click cycles a checklist item through the three statuses.
const NEXT_STATUS: Record<ChecklistItemStatus, ChecklistItemStatus> = {
  PENDING: 'VERIFIED',
  VERIFIED: 'REJECTED',
  REJECTED: 'PENDING',
};
const PREFILL_KEY = 'hq.onboard.prefill';

function idr(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

export default function HqApplicationDetailPage() {
  const param = useParams();
  const id = (Array.isArray(param.id) ? param.id[0] : param.id) ?? '';
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const detail = useAsync<FranchiseApplication>(
    () => api.get(endpoints.franchiseApps.detail(id), true),
    [id],
  );

  if (detail.loading) return <Skeleton className="h-96 w-full" />;

  const app = detail.data;
  if (detail.error || !app) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/hq/applications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
          <ArrowLeft size={16} weight="bold" /> {t('hq.applications.detail.back')}
        </Link>
        <ErrorState message={t('hq.applications.detail.notFound')} onRetry={detail.reload} />
      </div>
    );
  }

  const terminal = app.stage === 'APPROVED' || app.stage === 'REJECTED';
  const complete = CHECKLIST.every((k) => app.checklist[k] === 'VERIFIED');

  async function guarded(run: () => Promise<void>) {
    setBusy(true);
    try {
      await run();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.applications.detail.actionError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const cycleItem = (item: ChecklistItem) =>
    guarded(async () => {
      await api.patch(
        endpoints.franchiseApps.detail(app.id),
        { checklist: { [item]: NEXT_STATUS[app.checklist[item]] } },
        true,
      );
      detail.reload();
    });

  const setStage = (stage: FranchiseAppStage) =>
    guarded(async () => {
      await api.patch(endpoints.franchiseApps.detail(app.id), { stage }, true);
      detail.reload();
    });

  const approve = () =>
    guarded(async () => {
      const result = await api.post<ApproveApplicationResult>(
        endpoints.franchiseApps.approve(app.id),
        undefined,
        true,
      );
      // Stash the onboard-form prefill for the depots page to pick up.
      const p = result.proposedDepot;
      const prefill: Partial<DepotForm> = {
        code: p.code,
        name: p.name,
        ownershipType: p.ownershipType,
        city: p.city,
        province: p.province,
        lat: String(p.lat),
        lng: String(p.lng),
      };
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill));
      toast(t('hq.applications.detail.approved', { name: app.applicantName }), 'success');
      router.push('/hq/depots?onboard=1');
    });

  const reject = () =>
    guarded(async () => {
      await api.post(endpoints.franchiseApps.reject(app.id), undefined, true);
      toast(t('hq.applications.detail.rejected', { name: app.applicantName }), 'info');
      router.push('/hq/applications');
    });

  const age = ageDays(app.submittedAt);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/hq/applications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
        <ArrowLeft size={16} weight="bold" /> {t('hq.applications.detail.back')}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{app.applicantName}</h1>
        <Badge tone="brand">{t(`hq.applications.stageName.${app.stage}`)}</Badge>
        <Badge tone={age >= 5 ? 'danger' : 'neutral'}>{t('hq.applications.age', { n: age })}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.applications.proposed')}</p>
            <p className="mt-1 font-semibold">{app.proposedName}</p>
            <p className="text-sm text-muted">{app.proposedCode} · {app.city}, {app.province}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.applications.detail.contact')}</p>
              <p className="mt-1 text-sm">{app.applicantPhone}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.applications.detail.investment')}</p>
              <p className="mt-1 text-sm tabular-nums">{idr(app.investmentAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.applications.detail.projectedRevenue')}</p>
              <p className="mt-1 text-sm tabular-nums">{idr(app.projectedMonthlyRevenue)}</p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-extrabold">{t('hq.applications.detail.docsTitle')}</p>
              <Badge tone={complete ? 'success' : 'warning'}>
                {complete ? t('hq.applications.detail.complete') : t('hq.applications.detail.incomplete')}
              </Badge>
            </div>
            <ul className="flex flex-col gap-2">
              {CHECKLIST.map((key) => {
                const status = app.checklist[key];
                return (
                  <li key={key} className="flex items-center justify-between gap-2.5 text-sm">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={
                          'flex h-5 w-5 items-center justify-center rounded-full ' +
                          (status === 'VERIFIED'
                            ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                            : status === 'REJECTED'
                              ? 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
                              : 'bg-[color:var(--surface-soft)] text-muted')
                        }
                      >
                        {status === 'VERIFIED' ? (
                          <Check size={13} weight="bold" />
                        ) : status === 'REJECTED' ? (
                          <X size={13} weight="bold" />
                        ) : (
                          <DotsThree size={13} weight="bold" />
                        )}
                      </span>
                      <span className={status === 'VERIFIED' ? '' : 'text-muted'}>
                        {t(`hq.applications.detail.doc.${key}`)}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy || terminal}
                      onClick={() => cycleItem(key)}
                      className="rounded-md border border-app px-2 py-1 text-xs font-semibold text-muted transition-colors hover:text-brand-700 disabled:opacity-50"
                    >
                      {t(`hq.applications.detail.docStatus.${status}`)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>

        <Card className="flex h-fit flex-col gap-3 p-5">
          {!terminal && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.applications.detail.advance')}</p>
              <div className="flex flex-wrap gap-1.5">
                {EDITABLE_STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || app.stage === s}
                    onClick={() => setStage(s)}
                    className={
                      'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ' +
                      (app.stage === s ? 'bg-brand-600 text-on-brand' : 'border border-app text-muted hover:text-brand-700')
                    }
                  >
                    {t(`hq.applications.stageName.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Button className="w-full" onClick={approve} loading={busy} disabled={terminal}>
            {t('hq.applications.detail.provision')}
          </Button>
          <p className="text-xs text-muted">{t('hq.applications.detail.provisionHint')}</p>
          <Button variant="danger" className="w-full" onClick={reject} disabled={busy || terminal}>
            {t('hq.applications.detail.reject')}
          </Button>
        </Card>
      </div>
    </div>
  );
}
