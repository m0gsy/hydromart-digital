'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, DotsThree, X } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { DepotForm } from '@/components/hq/depot-form';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/custom-role';
import { DRAFT_CHECKLIST, earliestSigning, type DepotDraft } from '@/lib/depot-drafts';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';
import { todayWib } from '@/lib/wib';

/*
 * HD-21b: HQ decides on a depot draft from the CRM calon mitra.
 *  - Tolak: a note is required; the owner's name and phone are deleted at the decision.
 *  - "Undang pemilik dan aktifkan": the EXISTING staff invite first (a FRANCHISE_OWNER account from the
 *    draft's name and phone; a phone that already has an account is promoted, as everywhere), then the
 *    depot form opens prefilled and posts to the activate route, which creates the depot, closes the
 *    draft and records depot.onboarded in one transaction. Nothing is sent from the AI path (D4).
 */
export default function HqDepotDraftDetailPage() {
  const id = useQueryParam('id');
  const { t } = useT();
  const { toast } = useToast();
  const { askReason, confirm } = useConfirm();
  const router = useRouter();
  const { customer } = useAuth();
  const [busy, setBusy] = useState(false);
  // The invited owner's account id, kept so a failed save of the form never invites twice.
  const [ownerId, setOwnerIdState] = useState<string | null>(null);
  // Kept per draft in this tab, so a reload (or a failed save) finds the invite already made. The
  // server returns the same account for the same phone, so even a lost key never makes a second one.
  const storeKey = `hq.depotDraft.owner.${id}`;
  useEffect(() => {
    try {
      setOwnerIdState(sessionStorage.getItem(storeKey));
    } catch {
      /* storage blocked: the invite is simply asked again */
    }
  }, [storeKey]);
  const setOwnerId = (value: string) => {
    setOwnerIdState(value);
    try {
      sessionStorage.setItem(storeKey, value);
    } catch {
      /* not kept; still used for this render */
    }
  };

  const detail = useAsync<DepotDraft>(() => api.get(endpoints.depotDrafts.detail(id), true), [id]);

  if (detail.loading) return <Skeleton className="h-96 w-full" />;
  const draft = detail.data;
  if (detail.error || !draft) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/hq/depot-drafts" className="tap-44 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
          <ArrowLeft size={16} weight="bold" /> {t('hq.depotDrafts.detail.back')}
        </Link>
        <ErrorState message={t('hq.depotDrafts.detail.notFound')} onRetry={detail.reload} />
      </div>
    );
  }

  const open = draft.status === 'DRAFT';
  const earliest = earliestSigning(draft.prospectusHandedOn);
  const coolingMet = draft.agreementSignedOn >= earliest && draft.agreementSignedOn <= todayWib();
  const mayInvite = can('staffAdmin', customer?.role);

  async function guarded(run: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await run();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : fallback, 'error');
    } finally {
      setBusy(false);
    }
  }

  const reject = async () => {
    const note = await askReason({
      title: t('hq.depotDrafts.detail.rejectTitle'),
      // After an invite, the owner account stays: say so before the person decides.
      message: ownerId
        ? `${t('hq.depotDrafts.detail.rejectMessage')} ${t('hq.depotDrafts.detail.rejectAfterInvite')}`
        : t('hq.depotDrafts.detail.rejectMessage'),
      label: t('hq.depotDrafts.detail.rejectLabel'),
      placeholder: t('hq.depotDrafts.detail.rejectHint'),
      confirmLabel: t('hq.depotDrafts.detail.rejectConfirm'),
      optional: false,
      tone: 'danger',
    });
    if (!note) return;
    await guarded(async () => {
      await api.post(endpoints.depotDrafts.reject(draft.id), { note }, true);
      try {
        sessionStorage.removeItem(storeKey);
      } catch {
        /* nothing to forget */
      }
      toast(t('hq.depotDrafts.detail.rejected'), 'info');
      router.push('/hq/depot-drafts');
    }, t('hq.depotDrafts.detail.actionError'));
  };

  /**
   * The invite re-roles an account that already holds the phone: an employee would be demoted, their
   * HR record closed, a suspended login lifted. So the phone is looked up first (the staff phone
   * lookup HEAD_OFFICE already has) and only a number nobody holds, or a plain active customer who
   * agrees, is invited. An active franchise owner is simply reused.
   */
  const invite = () =>
    guarded(async () => {
      let existing: { id: string; role: string; status: string } | null = null;
      try {
        existing = await api.get<{ id: string; role: string; status: string }>(
          endpoints.auth.customerLookup(draft.ownerPhoneE164 ?? ''),
          true,
        );
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
      }
      if (existing) {
        if (existing.role === 'FRANCHISE_OWNER' && existing.status === 'ACTIVE') {
          setOwnerId(existing.id);
          toast(t('hq.depotDrafts.detail.ownerReused'), 'success');
          return;
        }
        if (existing.role !== 'CUSTOMER' || existing.status !== 'ACTIVE') {
          toast(
            t('hq.depotDrafts.detail.phoneTaken', { role: roleLabel(t, existing.role), status: existing.status }),
            'error',
          );
          return;
        }
        const yes = await confirm({
          title: t('hq.depotDrafts.detail.customerTitle'),
          message: t('hq.depotDrafts.detail.customerMessage'),
          confirmLabel: t('hq.depotDrafts.detail.customerConfirm'),
        });
        if (!yes) return;
      }
      const owner = await api.post<{ id: string }>(
        endpoints.auth.inviteStaff,
        {
          phone: draft.ownerPhoneE164,
          role: 'FRANCHISE_OWNER',
          fullName: draft.ownerFullName ?? undefined,
          // A franchise owner gets no employee record, but the API still validates the shape.
          position: 'Pemilik waralaba',
          joinDate: todayWib(),
          employmentStatus: 'PERMANENT',
          salaryType: 'MONTHLY',
          monthlyRate: 0,
        },
        true,
      );
      setOwnerId(owner.id);
      toast(t('hq.depotDrafts.detail.invited'), 'success');
    }, t('hq.depotDrafts.detail.inviteError'));

  const stateIcon = (state: string) =>
    state === 'VERIFIED' ? (
      <Check size={13} weight="bold" />
    ) : state === 'REJECTED' ? (
      <X size={13} weight="bold" />
    ) : (
      <DotsThree size={13} weight="bold" />
    );

  return (
    <div className="flex flex-col gap-6">
      <Link href="/hq/depot-drafts" className="tap-44 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
        <ArrowLeft size={16} weight="bold" /> {t('hq.depotDrafts.detail.back')}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{draft.proposedName}</h1>
        <Badge tone={open ? 'warning' : draft.status === 'ACTIVATED' ? 'success' : 'danger'}>
          {t(`hq.depotDrafts.status.${draft.status}`)}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.depotDrafts.detail.proposed')}</p>
            <p className="mt-1 font-semibold">{draft.proposedName}</p>
            <p className="text-sm text-muted">
              {draft.city}, {draft.province}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.depotDrafts.detail.owner')}</p>
            {draft.ownerFullName ? (
              <p className="mt-1 text-sm">
                {draft.ownerFullName} · {draft.ownerPhoneE164}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">{t('hq.depotDrafts.detail.ownerCleared')}</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-extrabold">{t('hq.depotDrafts.detail.checklistTitle')}</p>
            <ul className="flex flex-col gap-2">
              {DRAFT_CHECKLIST.map((key) => {
                const state = draft.checklist[key];
                return (
                  <li key={key} className="flex items-center justify-between gap-2.5 text-sm">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={
                          'flex h-5 w-5 items-center justify-center rounded-full ' +
                          (state === 'VERIFIED'
                            ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                            : state === 'REJECTED'
                              ? 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]'
                              : 'bg-[color:var(--surface-soft)] text-muted')
                        }
                      >
                        {stateIcon(state)}
                      </span>
                      {t(`hq.depotDrafts.detail.item.${key}`)}
                    </span>
                    <span className="text-xs font-semibold text-muted">{t(`hq.depotDrafts.detail.state.${state}`)}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.depotDrafts.detail.prospectus')}</p>
              <p className="mt-1 text-sm">
                {t('hq.depotDrafts.detail.versionLabel')}: {draft.prospectusVersionLabel}
              </p>
              <p className="text-sm">
                {t('hq.depotDrafts.detail.receipt')}: {draft.prospectusReceipt}
              </p>
              <p className="text-sm">
                {t('hq.depotDrafts.detail.handedOn')}: {draft.prospectusHandedOn}
              </p>
              <p className="mt-1 break-all text-xs text-muted">
                {t('hq.depotDrafts.detail.sha')}: {draft.prospectusSha256}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.depotDrafts.detail.agreement')}</p>
              <p className="mt-1 text-sm">
                {t('hq.depotDrafts.detail.signedOn')}: {draft.agreementSignedOn}
              </p>
              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted">{t('hq.depotDrafts.detail.coolingTitle')}</p>
              <Badge tone={coolingMet ? 'success' : 'danger'}>
                {t(coolingMet ? 'hq.depotDrafts.detail.coolingOk' : 'hq.depotDrafts.detail.coolingNot', {
                  signed: draft.agreementSignedOn,
                  earliest,
                })}
              </Badge>
            </div>
          </div>
        </Card>

        <Card className="flex h-fit flex-col gap-3 p-5">
          {open ? (
            <>
              <Button className="w-full" onClick={invite} loading={busy} disabled={!mayInvite || ownerId !== null}>
                {t('hq.depotDrafts.detail.activate')}
              </Button>
              <p className="text-xs text-muted">
                {mayInvite ? t('hq.depotDrafts.detail.activateHint') : t('hq.depotDrafts.detail.needStaffAdmin')}
              </p>
              <Button variant="danger" className="w-full" onClick={reject} disabled={busy}>
                {t('hq.depotDrafts.detail.reject')}
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('hq.depotDrafts.detail.decision')}</p>
              {draft.decisionNote ? (
                <p>
                  <span className="font-semibold">{t('hq.depotDrafts.detail.decisionNote')}:</span> {draft.decisionNote}
                </p>
              ) : null}
              {draft.depotId ? (
                <Link href={`/hq/depots/detail?id=${draft.depotId}`} className="font-semibold text-brand-700">
                  {t('hq.depotDrafts.detail.openDepot')}
                </Link>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      {open && ownerId ? (
        <DepotForm
          depot={null}
          initial={{
            name: draft.proposedName,
            city: draft.city,
            province: draft.province,
            ownershipType: 'WARALABA',
            owners: [{ ownerId, sharePct: '100', isPrimary: true }],
          }}
          submitTo={endpoints.depotDrafts.activate(draft.id)}
          onDone={() => {
            toast(t('hq.depotDrafts.detail.activated'), 'success');
            router.push('/hq/depot-drafts');
          }}
          onCancel={() => router.push('/hq/depot-drafts')}
        />
      ) : null}
    </div>
  );
}
