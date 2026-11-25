'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, XCircle } from '@phosphor-icons/react';

import { CashReturnedAsk } from '@/components/driver/cash-returned-ask';
import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useBack } from '@/lib/use-back';
import { endpoints } from '@/lib/endpoints';
import { runOrQueue, type CourierFailureCode } from '@/lib/offline-queue';
import { useAsync } from '@/lib/use-async';
import type { Delivery } from '@/lib/types';
import { useT } from '@/lib/locale-context';
import { useQueryParam } from '@/lib/use-query-param';

const CODES = [
  { key: 'addressNotFound', code: 'ADDRESS_NOT_FOUND' },
  { key: 'customerRefused', code: 'CUSTOMER_REFUSED' },
  { key: 'goodsDamaged', code: 'GOODS_DAMAGED' },
  { key: 'cannotContact', code: 'CANNOT_CONTACT' },
  { key: 'other', code: 'OTHER' },
] as const;

const NOTE_MAX = 255;

function Fail() {
  const router = useRouter();
  const back = useBack();
  const { t } = useT();
  const id = useQueryParam('id');
  const [code, setCode] = useState<CourierFailureCode | ''>('');
  const [note, setNote] = useState('');
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
    if (!code) return;
    const text = note.trim();
    setBusy(true);
    setError(null);
    try {
      // K2.9: a failed delivery is a state the courier cannot re-derive later — they have
      // already left. Queued rather than lost when the signal drops.
      await runOrQueue({
        kind: 'deliveryFail',
        payload: {
          deliveryId: id,
          reasonCode: code,
          ...(text ? { note: text } : {}),
          cashReturned: cashReturned ?? false,
        },
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
        <button type="button" onClick={back} className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-extrabold">{t('driver.deliveryFail.title')}</div>
      </header>

      <Card className="space-y-4 p-4">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-bold">{t('driver.deliveryFail.reasonLabel')}</legend>
          <div className="flex flex-col gap-2">
            {CODES.map((r) => (
              <label
                key={r.code}
                className={`flex min-h-11 cursor-pointer items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-bold focus-within:outline focus-within:outline-2 focus-within:outline-brand-600 ${r.code === code ? 'bg-brand-600 text-white' : 'bg-black/5'}`}
              >
                <input
                  type="radio"
                  name="reasonCode"
                  value={r.code}
                  checked={r.code === code}
                  onChange={() => setCode(r.code)}
                  className="sr-only"
                />
                {t(`driver.deliveryFail.reasons.${r.key}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t('driver.deliveryFail.noteLabel')} htmlFor="note">
          <Input id="note" maxLength={NOTE_MAX} placeholder={t('driver.deliveryFail.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Card>

      {mustAnswerCash && (
        <CashReturnedAsk
          amount={delivery.data?.codAmount}
          value={cashReturned}
          onChange={setCashReturned}
        />
      )}

      <FormError message={error} />

      <Button loading={busy} disabled={!code || (mustAnswerCash && cashReturned === null)} className="flex w-full items-center justify-center gap-2 bg-red-600 hover:bg-red-700" onClick={submit}>
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
