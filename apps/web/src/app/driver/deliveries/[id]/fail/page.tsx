'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, XCircle } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

// value = the reason stored on the delivery record (kept stable); label is translated.
const REASONS = [
  { key: 'addressNotFound', value: 'Alamat tidak ditemukan' },
  { key: 'customerRefused', value: 'Pelanggan menolak' },
  { key: 'goodsDamaged', value: 'Barang rusak' },
  { key: 'cannotContact', value: 'Pelanggan tidak bisa dihubungi' },
] as const;

function Fail() {
  const router = useRouter();
  const { t } = useT();
  const id = String(useParams().id);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = reason.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(endpoints.deliveries.driver.fail(id), { reason: value }, true);
      router.replace('/driver');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.deliveryFail.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-extrabold">{t('driver.deliveryFail.title')}</div>
      </header>

      <Card className="space-y-4 p-4">
        <Field label={t('driver.deliveryFail.reasonLabel')}>
          <div className="flex flex-col gap-2">
            {REASONS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setReason(r.value)}
                className={`rounded-xl px-3.5 py-2.5 text-left text-sm font-bold ${r.value === reason ? 'bg-brand-600 text-white' : 'bg-black/5'}`}
              >
                {t(`driver.deliveryFail.reasons.${r.key}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('driver.deliveryFail.otherLabel')} htmlFor="reason">
          <Input id="reason" placeholder={t('driver.deliveryFail.otherPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button loading={busy} disabled={!reason.trim()} className="flex w-full items-center justify-center gap-2 bg-red-600 hover:bg-red-700" onClick={submit}>
        <XCircle size={19} weight="fill" />
        {t('driver.deliveryFail.submit')}
      </Button>
    </div>
  );
}

export default function FailPage() {
  return (
    <DriverShell nav={false}>
      <Fail />
    </DriverShell>
  );
}
