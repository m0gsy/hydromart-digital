'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, XCircle } from '@phosphor-icons/react';

import { CashReturnedAsk } from '@/components/driver/cash-returned-ask';
import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { runOrQueue } from '@/lib/offline-queue';
import { useAsync } from '@/lib/use-async';
import type { Delivery } from '@/lib/types';
import { useT } from '@/lib/locale-context';
import { useQueryParam } from '@/lib/use-query-param';

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
  const id = useQueryParam('id');
  const [reason, setReason] = useState('');
  /*
   * CA-4-03: whether this courier is holding the order's cash is the SERVER's answer, not
   * a guess from `codAmount` — that column says cash should be collected here, never that
   * it was. Read here so the question below appears only when there is real money at stake.
   */
  const delivery = useAsync<Delivery>(
    () => api.get<Delivery>(endpoints.deliveries.driver.get(id), true),
    [id],
  );
  const [cashReturned, setCashReturned] = useState<boolean | null>(null);
  const mustAnswerCash = Boolean(delivery.data?.cashHeld);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = reason.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      // K2.9: a failed delivery is a state the courier cannot re-derive later — they have
      // already left. Queued rather than lost when the signal drops.
      await runOrQueue({
        kind: 'deliveryFail',
        payload: { deliveryId: id, reason: value, cashReturned: cashReturned ?? false },
      });
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
        <button type="button" onClick={() => router.back()} className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)]">
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
                className={`min-h-11 rounded-xl px-3.5 py-2.5 text-left text-sm font-bold ${r.value === reason ? 'bg-brand-600 text-white' : 'bg-black/5'}`}
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

      {mustAnswerCash && (
        <CashReturnedAsk
          amount={delivery.data?.codAmount}
          value={cashReturned}
          onChange={setCashReturned}
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button loading={busy} disabled={!reason.trim() || (mustAnswerCash && cashReturned === null)} className="flex w-full items-center justify-center gap-2 bg-red-600 hover:bg-red-700" onClick={submit}>
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
