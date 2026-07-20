'use client';

import { useEffect, useRef, useState } from 'react';
import { Bank, CreditCard, Lock, Money, QrCode, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canManageDepots } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotAdmin } from '@/lib/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const QRIS_MAX_BYTES = 5 * 1024 * 1024;

/** One payment-method row. Enablement is derived from whether it is configured — there
 *  is no separate enable flag in the depot schema (payment goes direct to each depot). */
function MethodRow({
  icon,
  title,
  desc,
  active,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active: boolean;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-3 border-t border-app py-3 first:border-0 first:pt-0">
      <span className="text-brand-500">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted">{desc}</p>
      </div>
      <Badge tone={active ? 'success' : 'neutral'}>{active ? t('dashB.payments.active') : t('dashB.payments.notSet')}</Badge>
    </div>
  );
}

/** QRIS static-image panel: preview current + upload a replacement. */
function QrisPanel({ depot, onUploaded }: { depot: DepotAdmin; onUploaded: (d: DepotAdmin) => void }) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > QRIS_MAX_BYTES) {
      setError(t('dashB.payments.imageTooLarge'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadFile<DepotAdmin>(endpoints.depots.uploadQris(depot.id), file);
      onUploaded(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.payments.qrisUploadError'));
    } finally {
      setBusy(false);
    }
  }

  const src = depot.paymentQrisImageUrl
    ? depot.paymentQrisImageUrl.startsWith('http')
      ? depot.paymentQrisImageUrl
      : `${BASE_URL}${depot.paymentQrisImageUrl}`
    : null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <QrCode size={20} weight="fill" className="text-brand-500" />
        <h2 className="text-lg font-semibold">{t('dashB.payments.qrisStatic')}</h2>
      </div>
      <p className="text-sm text-muted">
        {t('dashB.payments.qrisHint')}
      </p>
      {src ? (
        <img
          src={src}
          alt={t('dashB.payments.qrisAlt')}
          className="mx-auto h-48 w-48 rounded-lg border border-app object-contain"
        />
      ) : (
        <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-lg border border-dashed border-app text-sm text-muted">
          {t('dashB.payments.noQris')}
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPick} />
      <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>
        {depot.paymentQrisImageUrl ? t('dashB.payments.replaceQris') : t('dashB.payments.uploadQris')}
      </Button>
    </Card>
  );
}

/** Bank-account form saved via the depot update endpoint. */
function BankForm({ depot, onSaved }: { depot: DepotAdmin; onSaved: (d: DepotAdmin) => void }) {
  const { t } = useT();
  const [bankName, setBankName] = useState(depot.paymentBankName ?? '');
  const [accountNumber, setAccountNumber] = useState(depot.paymentBankAccountNumber ?? '');
  const [accountHolder, setAccountHolder] = useState(depot.paymentBankAccountHolder ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.patch<DepotAdmin>(
        endpoints.depots.detail(depot.id),
        {
          paymentBankName: bankName.trim() || null,
          paymentBankAccountNumber: accountNumber.trim() || null,
          paymentBankAccountHolder: accountHolder.trim() || null,
        },
        true,
      );
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.payments.bankSaveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Bank size={20} weight="fill" className="text-brand-500" />
        <h2 className="text-lg font-semibold">{t('dashB.payments.bankTitle')}</h2>
      </div>
      <Field label={t('dashB.payments.bankLabel')} htmlFor="bank-name">
        <Input
          id="bank-name"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          placeholder={t('dashB.payments.bankPlaceholder')}
        />
      </Field>
      <Field label={t('dashB.payments.accountNumber')} htmlFor="bank-number">
        <Input
          id="bank-number"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          placeholder={t('dashB.payments.accountNumberPlaceholder')}
        />
      </Field>
      <Field label={t('dashB.payments.accountHolder')} htmlFor="bank-holder">
        <Input
          id="bank-holder"
          value={accountHolder}
          onChange={(e) => setAccountHolder(e.target.value)}
          placeholder={t('dashB.payments.accountHolderPlaceholder')}
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="text-sm font-medium text-emerald-700">{t('dashB.payments.bankSaved')}</p>}
      <div className="flex justify-end">
        <Button onClick={save} loading={busy}>
          {t('dashB.payments.saveBank')}
        </Button>
      </div>
    </Card>
  );
}

function PaymentsBody() {
  const { t } = useT();
  const { scopedId, selected, depots, ready } = useDepot();
  const detail = useAsync<DepotAdmin>(
    () =>
      scopedId
        ? api.get(endpoints.depots.detail(scopedId), true)
        : Promise.reject(new ApiError(0, 'no depot')),
    [scopedId],
  );
  const [depot, setDepot] = useState<DepotAdmin | null>(null);
  useEffect(() => {
    if (detail.data) setDepot(detail.data);
  }, [detail.data]);

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashB.payments.title')}</h1>
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          {t('dashB.payments.scopedBefore')}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>
          {t('dashB.payments.scopedAfter')}
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashB.payments.noDepots')} icon={<Wallet size={40} weight="fill" />}>
          {t('dashB.payments.noDepotsBody')}
        </CenterState>
      ) : detail.loading || !depot ? (
        <Skeleton className="h-96 w-full" />
      ) : detail.error ? (
        <ErrorState message={detail.error} onRetry={detail.reload} />
      ) : (
        <>
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <CreditCard size={20} weight="fill" className="text-brand-500" />
              <h2 className="text-lg font-semibold">{t('dashB.payments.paymentMethods')}</h2>
            </div>
            <MethodRow
              icon={<Money size={20} weight="fill" />}
              title={t('dashB.payments.codTitle')}
              desc={t('dashB.payments.codDesc')}
              active
            />
            <MethodRow
              icon={<QrCode size={20} weight="fill" />}
              title={t('dashB.payments.qrisStatic')}
              desc={t('dashB.payments.qrisDesc')}
              active={!!depot.paymentQrisImageUrl}
            />
            <MethodRow
              icon={<Bank size={20} weight="fill" />}
              title={t('dashB.payments.bankMethodTitle')}
              desc={t('dashB.payments.bankMethodDesc')}
              active={!!depot.paymentBankAccountNumber}
            />
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <BankForm depot={depot} onSaved={setDepot} />
            <QrisPanel depot={depot} onUploaded={setDepot} />
          </div>
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManageDepots(customer?.role)) {
    return (
      <CenterState title={t('dashB.payments.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.payments.gateBody')}
      </CenterState>
    );
  }
  return <PaymentsBody />;
}

export default function PaymentsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
