'use client';

import { useEffect, useRef, useState } from 'react';
import { Bank, CreditCard, Lock, Money, QrCode, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError, uploadFile } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
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
  return (
    <div className="flex items-center gap-3 border-t border-app py-3 first:border-0 first:pt-0">
      <span className="text-brand-500">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted">{desc}</p>
      </div>
      <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Aktif' : 'Belum diatur'}</Badge>
    </div>
  );
}

/** QRIS static-image panel: preview current + upload a replacement. */
function QrisPanel({ depot, onUploaded }: { depot: DepotAdmin; onUploaded: (d: DepotAdmin) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > QRIS_MAX_BYTES) {
      setError('Ukuran gambar maksimal 5MB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadFile<DepotAdmin>(endpoints.depots.uploadQris(depot.id), file);
      onUploaded(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengunggah QRIS.');
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
        <h2 className="text-lg font-semibold">QRIS statis</h2>
      </div>
      <p className="text-sm text-muted">
        Gambar QRIS ini ditampilkan ke pelanggan saat pembayaran. Format JPG, PNG, atau WEBP (maks 5MB).
      </p>
      {src ? (
        <img
          src={src}
          alt="QRIS depot"
          className="mx-auto h-48 w-48 rounded-lg border border-app object-contain"
        />
      ) : (
        <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-lg border border-dashed border-app text-sm text-muted">
          Belum ada QRIS
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPick} />
      <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>
        {depot.paymentQrisImageUrl ? 'Ganti gambar QRIS' : 'Unggah gambar QRIS'}
      </Button>
    </Card>
  );
}

/** Bank-account form saved via the depot update endpoint. */
function BankForm({ depot, onSaved }: { depot: DepotAdmin; onSaved: (d: DepotAdmin) => void }) {
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
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan rekening.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Bank size={20} weight="fill" className="text-brand-500" />
        <h2 className="text-lg font-semibold">Rekening transfer bank</h2>
      </div>
      <Field label="Bank" htmlFor="bank-name">
        <Input
          id="bank-name"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          placeholder="mis. BCA"
        />
      </Field>
      <Field label="No. rekening" htmlFor="bank-number">
        <Input
          id="bank-number"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
          placeholder="mis. 1234567890"
        />
      </Field>
      <Field label="Atas nama" htmlFor="bank-holder">
        <Input
          id="bank-holder"
          value={accountHolder}
          onChange={(e) => setAccountHolder(e.target.value)}
          placeholder="mis. PT Hydromart Depot Cikini"
        />
      </Field>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="text-sm font-medium text-emerald-700">Rekening tersimpan.</p>}
      <div className="flex justify-end">
        <Button onClick={save} loading={busy}>
          Simpan rekening
        </Button>
      </div>
    </Card>
  );
}

function PaymentsBody() {
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
        <h1 className="text-2xl font-bold">Pembayaran &amp; QRIS</h1>
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          Mengatur pembayaran untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          (dari switcher).
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<Wallet size={40} weight="fill" />}>
          Belum ada depot yang bisa diatur.
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
              <h2 className="text-lg font-semibold">Metode pembayaran</h2>
            </div>
            <MethodRow
              icon={<Money size={20} weight="fill" />}
              title="COD (bayar di tempat)"
              desc="Kurir menerima tunai saat pengantaran."
              active
            />
            <MethodRow
              icon={<QrCode size={20} weight="fill" />}
              title="QRIS statis"
              desc="Pelanggan scan QRIS depot untuk membayar."
              active={!!depot.paymentQrisImageUrl}
            />
            <MethodRow
              icon={<Bank size={20} weight="fill" />}
              title="Transfer bank"
              desc="Transfer ke rekening depot, dikonfirmasi staf."
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
  const { customer } = useAuth();
  if (!canManageDepots(customer?.role)) {
    return (
      <CenterState title="Akses manajer depot" icon={<Lock size={40} weight="fill" />}>
        Pengaturan pembayaran hanya untuk manajer depot dan super admin.
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
