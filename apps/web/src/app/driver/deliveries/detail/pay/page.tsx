'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle, Coins } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, ErrorState, Field, FormError, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { runOrQueue } from '@/lib/offline-queue';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Delivery, Payment } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';

// Common cash denominations offered as quick-fill chips (IDR).
const NOTES = [50000, 100000, 150000, 200000];

function Pay() {
  const router = useRouter();
  const { t } = useT();
  const id = useQueryParam('id');
  const load = useAsync<{ delivery: Delivery; cod: Payment | null }>(async () => {
    const delivery = await api.get<Delivery>(endpoints.deliveries.driver.get(id), true);
    const pays = await api.get<{ items: Payment[] }>(
      endpoints.payments.forOrderStaff(delivery.orderId),
      true,
    );
    const cod = pays.items.find((p) => p.method === 'CASH' && p.status === 'PENDING') ?? null;
    return { delivery, cod };
  }, [id]);

  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Payment | null>(null);
  // K2.9: queued, not done. The change owed cannot be computed from a server response that
  // has not happened yet, so the courier is told plainly rather than shown a Rp 0 change.
  const [queued, setQueued] = useState(false);

  const amount = load.data?.cod?.amount ?? 0;
  const received = Number(cash) || 0;
  const change = useMemo(() => Math.max(0, received - amount), [received, amount]);
  const short = received > 0 && received < amount;

  if (load.loading) return <div className="p-5"><Skeleton className="h-80 w-full" /></div>;
  if (load.error || !load.data) {
    return <div className="p-5"><ErrorState message={load.error ?? t('driver.pay.loadError')} onRetry={load.reload} /></div>;
  }

  const { delivery, cod } = load.data;

  const confirm = async () => {
    if (!cod) return;
    setBusy(true);
    setError(null);
    try {
      // K2.9: through the offline queue, not straight at the API. The customer has already
      // handed over the notes — losing this call because the signal dropped means the
      // courier is carrying cash the system has no record of.
      const out = await runOrQueue<Payment>({
        kind: 'codConfirm',
        payload: { paymentId: cod.id, cashReceived: received },
      });
      if (out.outcome === 'queued') {
        setQueued(true);
        return;
      }
      setDone(out.result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.pay.confirmError'));
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
        <div className="flex-1">
          <div className="text-sm font-extrabold">{t('driver.pay.title')}</div>
          <div className="text-[11px] tabular-nums text-[color:var(--muted)]">{delivery.orderNumber}</div>
        </div>
      </header>

      {queued ? (
        <Card className="flex flex-col items-center gap-2 p-6 text-center">
          <CheckCircle size={44} weight="fill" className="text-amber-500" />
          <div className="text-base font-extrabold">{t('driver.pay.queuedTitle')}</div>
          <div className="text-sm text-[color:var(--muted)]">{t('driver.pay.queuedBody')}</div>
          <Button className="mt-3 w-full" onClick={() => router.replace(`/driver/deliveries/detail?id=${id}`)}>
            {t('driver.pay.doneNext')}
          </Button>
        </Card>
      ) : done ? (
        <Card className="flex flex-col items-center gap-2 p-6 text-center">
          <CheckCircle size={44} weight="fill" className="text-green-600" />
          <div className="text-base font-extrabold">{t('driver.pay.doneTitle')}</div>
          <div className="text-sm text-[color:var(--muted)]">{t('driver.pay.doneChangeLabel')}</div>
          <Money amount={done.changeGiven ?? 0} className="text-2xl font-extrabold" />
          <Button className="mt-3 w-full" onClick={() => router.replace(`/driver/deliveries/detail?id=${id}`)}>
            {t('driver.pay.doneNext')}
          </Button>
        </Card>
      ) : !cod ? (
        <Card className="p-5 text-sm text-[color:var(--muted)]">
          {t('driver.pay.noCod')}
        </Card>
      ) : (
        <>
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm font-bold">{t('driver.pay.totalDue')}</span>
            <Money amount={amount} className="text-xl font-extrabold text-brand-700" />
          </Card>

          <Card className="space-y-3 p-4">
            <Field label={t('driver.pay.cashLabel')} htmlFor="cash" error={short ? t('driver.pay.shortError') : undefined}>
              <Input
                id="cash"
                inputMode="numeric"
                placeholder="0"
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setCash(String(amount))} className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold">
                {t('driver.pay.exact')}
              </button>
              {NOTES.filter((n) => n >= amount).map((n) => (
                <button key={n} type="button" onClick={() => setCash(String(n))} className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold tabular-nums">
                  {n.toLocaleString('id-ID')}
                </button>
              ))}
            </div>
          </Card>

          <Card className="flex items-center justify-between p-4">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Coins size={16} weight="fill" className="text-brand-700" /> {t('driver.pay.change')}
            </span>
            <Money amount={change} className="text-xl font-extrabold" />
          </Card>

          <FormError message={error} />

          <Button loading={busy} disabled={received < amount} className="w-full" onClick={confirm}>
            {t('driver.pay.confirm')}
          </Button>
        </>
      )}
    </div>
  );
}

export default function DriverPayPage() {
  return (
    <DriverShell nav={false}>
      <Pay />
    </DriverShell>
  );
}
