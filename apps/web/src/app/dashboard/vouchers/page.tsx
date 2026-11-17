'use client';

import { useState } from 'react';
import { useConfirm } from '@/components/confirm';
import { useT } from '@/lib/locale-context';
import { Lock, Ticket } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { VoucherForm } from '@/components/voucher-form';
import { VoucherSummary } from '@/components/voucher-summary';
import { useToast } from '@/components/toast';
import { Button, Card, CenterState, ErrorState, Field, FormError, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canManageVouchers, canViewVouchers, canWriteVoucher, voucherNeedsDepot } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, Page, Voucher } from '@/lib/types';

function GrantPanel({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const { t } = useT();
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<Customer | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<boolean | null>(null); // true = granted, false = already had it

  async function search() {
    if (!phone.trim()) {
      setError(t('hrFix.vouchers.phoneRequired'));
      return;
    }
    setSearching(true);
    setError(null);
    setFound(null);
    try {
      const customer = await api.get<Customer>(endpoints.auth.customerLookup(phone.trim()), true);
      setFound(customer);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? t('hrFix.vouchers.customerNotFound')
            : err.message
          : t('hrFix.vouchers.searchFailed'),
      );
    } finally {
      setSearching(false);
    }
  }

  async function grant() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ granted: boolean }>(
        endpoints.vouchers.grant(voucher.id),
        { customerId: found.id },
        true,
      );
      setDone(res.granted);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.vouchers.grantFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-brand-200 p-4">
      <h3 className="font-semibold">{t('hrFix.vouchers.giveTitle', { code: voucher.code })}</h3>
      {done !== null ? (
        <>
          <p className="text-sm text-muted">
            {done
              ? t('opsFix.vouchers.landedInWallet', { who: found?.fullName ?? found?.phone ?? t('opsFix.vouchers.aCustomer') })
              : t('hrFix.vouchers.alreadyHas')}
          </p>
          <div>
            <Button variant="ghost" onClick={onClose}>
              {t('hrFix.vouchers.close2')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Field label={t('hrFix.vouchers.customerPhone')} hint={t('hrFix.vouchers.phoneHint')}>
            <div className="flex gap-2">
              <Input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setFound(null);
                }}
                placeholder="081234567890"
                onKeyDown={(e) => e.key === 'Enter' && search()}
              />
              <Button variant="ghost" onClick={search} loading={searching}>
                {t('hrFix.vouchers.search2')}
              </Button>
            </div>
          </Field>
          {found && (
            <p className="text-sm">
              {t('hrFix.vouchers.found')} <span className="font-semibold">{found.fullName ?? t('hrFix.vouchers.noName')}</span>{' '}
              <span className="text-muted">{found.phone}</span>
            </p>
          )}
          <FormError message={error} />
          <div className="flex gap-2">
            <Button onClick={grant} loading={busy} disabled={!found}>
              {t('hrFix.vouchers.giveConfirm')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('hrFix.vouchers.cancel3')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function VouchersAdmin() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const canWrite = canManageVouchers(customer?.role);
  const { depots, scopedId } = useDepot();
  const depotName = (id: string) => depots.find((d) => d.id === id)?.name ?? t('hrFix.vouchers.otherDepot');
  const [editing, setEditing] = useState<Voucher | null | undefined>(undefined); // undefined closed, null new
  const [granting, setGranting] = useState<Voucher | null>(null);
  // The denied screen below used to render AFTER this request had already gone out, so a role
  // without `voucherRead` (a KEPALA_DEPOT typing the URL) saw the right screen and a 403 in the
  // console. Ask only when the answer is allowed.
  const mayView = !customer || canViewVouchers(customer.role);
  const { data, error, loading, reload } = useAsync<Page<Voucher>>(
    () =>
      mayView
        ? api.get<Page<Voucher>>(endpoints.vouchers.browse(), true)
        : Promise.resolve({ items: [], total: 0, page: 1, limit: 20 } as Page<Voucher>),
    [mayView],
  );

  if (customer && !canViewVouchers(customer.role)) {
    return (
      <CenterState icon={<Lock size={48} weight="thin" />} title={t('hrFix.vouchers.denied')}>
        {t('hrFix.vouchers.gateBody2')}
      </CenterState>
    );
  }

  // Audit F-14: a rejected deactivation used to be swallowed — the voucher stayed
  // live and the list redrew as if the click had worked.
  async function deactivate(v: Voucher) {
    if (
      !(await confirm({
        title: t('hrFix.confirmGap.deactivateTitle'),
        message: t('hrFix.confirmGap.deactivateMessage'),
        confirmLabel: t('hrFix.confirmGap.deactivateConfirm'), tone: 'danger',
      }))
    )
      return;
    try {
      await api.del(endpoints.vouchers.detail(v.id), true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.vouchers.deactivateFailed'), 'error');
    }
    reload();
  }

  const vouchers = data?.items ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Ticket size={24} weight="fill" className="text-brand-600" /> {t('hq.vouchers.title')}
          </h1>
          <p className="text-sm text-muted">{t('hq.vouchers.subtitle')}</p>
        </div>
        {canWrite && editing === undefined && <Button onClick={() => setEditing(null)}>{t('hrFix.vouchers.newVoucher')}</Button>}
      </div>

      {editing !== undefined && (
        <Card className="p-5">
          {/* The shared editor (components/voucher-form.tsx). A depot-scoped author picks among
              their own depots; head office may also leave it to the whole network. */}
          <VoucherForm
            voucher={editing}
            ownDepots={voucherNeedsDepot(customer?.role) ? depots : undefined}
            defaultDepotId={scopedId ?? ''}
            onCancel={() => setEditing(undefined)}
            onDone={() => {
              setEditing(undefined);
              reload();
            }}
          />
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : vouchers.length === 0 ? (
        <CenterState icon={<Ticket size={48} weight="thin" />} title={t('hrFix.vouchers.emptyTitle')}>
          {canWrite ? t('hrFix.vouchers.emptyBody') : t('hrFix.vouchers.noneCreated')}
        </CenterState>
      ) : (
        <div className="flex flex-col divide-y divide-[color:var(--border)]">
          {vouchers.map((v) => (
            <div key={v.id} className="flex flex-col gap-3 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <VoucherSummary voucher={v} depotName={depotName} />
                </div>
                {canWriteVoucher(customer?.role, v) && (
                  <>
                    <Button variant="ghost" onClick={() => setGranting(granting?.id === v.id ? null : v)}>
                      {t('hrFix.vouchers.give')}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(v)}>
                      {t('hq.vouchers.list.edit')}
                    </Button>
                    {v.active && (
                      <Button variant="danger" onClick={() => deactivate(v)}>
                        {t('opsFix.vouchers.deactivate')}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {granting?.id === v.id && <GrantPanel voucher={v} onClose={() => setGranting(null)} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VouchersPage() {
  return (
    <RequireAuth>
      <VouchersAdmin />
    </RequireAuth>
  );
}
