'use client';

import { useMemo, useState } from 'react';
import { ArrowsClockwise, BellSlash, Pause, Percent, Truck } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { ConfirmDialog } from '@/components/overlay';
import { Button, Chip, ErrorState, Field, LinkButton, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import { subscriptions as subID } from '@/lib/dictionaries/id/subscriptions';
import { subscriptions as subEN } from '@/lib/dictionaries/en/subscriptions';
import type { Address, Page as Paged, Product, Subscription, SubscriptionFrequency } from '@/lib/types';

const FREQS: SubscriptionFrequency[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'];
const BENEFIT_ICONS = [Percent, Truck, BellSlash, Pause];

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10); // yyyy-mm-dd for <input type="date">
}

function Panel() {
  const { t, locale } = useT();
  const { toast } = useToast();
  const copy = locale === 'en' ? subEN : subID;

  const products = useAsync<Paged<Product>>(() => api.get(endpoints.products.browse({ limit: 50 })));
  const addresses = useAsync<Address[]>(() => api.get(endpoints.addresses.list, true));
  const subs = useAsync<Subscription[]>(() => api.get(endpoints.subscriptions.list, true));

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(2);
  const [frequency, setFrequency] = useState<SubscriptionFrequency>('WEEKLY');
  const [firstDate, setFirstDate] = useState(inDays(1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const primaryAddress = useMemo(
    () => addresses.data?.find((a) => a.isPrimary) ?? addresses.data?.[0] ?? null,
    [addresses.data],
  );

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !primaryAddress) return;
    setSaving(true);
    setError(null);
    try {
      const a = primaryAddress;
      await api.post(
        endpoints.subscriptions.create,
        {
          productId,
          quantity,
          frequency,
          firstDeliveryAt: new Date(`${firstDate}T00:00:00`).toISOString(),
          deliveryAddress: {
            recipientName: a.recipientName,
            phone: a.phone,
            addressLine: a.addressLine,
            city: a.city,
            province: a.province,
            postalCode: a.postalCode,
            latitude: a.latitude,
            longitude: a.longitude,
          },
        },
        true,
      );
      toast(copy.started, 'success');
      setProductId('');
      subs.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.createError);
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: 'pause' | 'resume' | 'cancel') {
    setBusyId(id);
    try {
      await api.post(endpoints.subscriptions[action](id), {}, true);
      subs.reload();
    } finally {
      setBusyId(null);
      setCancelId(null);
    }
  }

  const statusTone: Record<Subscription['status'], 'success' | 'outline'> = {
    ACTIVE: 'success',
    PAUSED: 'outline',
    CANCELLED: 'outline',
  };

  return (
    <div>
      <h1 className="mb-5 text-[28px] font-extrabold tracking-[-0.03em]">{copy.title}</h1>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* setup */}
        <form onSubmit={create} className="surface flex flex-col gap-4 rounded-[22px] border border-app p-6">
          <div>
            <Chip tone="tint">
              <ArrowsClockwise size={14} weight="fill" /> {copy.title}
            </Chip>
            <div className="mt-3 text-[22px] font-extrabold tracking-[-0.02em]">{copy.setupHeading}</div>
          </div>

          <Field label={copy.product} htmlFor="sub-product">
            {products.loading ? (
              <Skeleton className="h-12 w-full rounded-xl" />
            ) : (
              <select
                id="sub-product"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                required
                className="h-12 w-full rounded-[14px] border-[1.5px] border-app surface px-3.5 text-sm outline-none focus:border-brand-600"
              >
                <option value="" disabled>
                  {copy.productPlaceholder}
                </option>
                {products.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.unit}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={copy.quantity} htmlFor="sub-qty">
              <div className="flex h-12 items-center justify-between rounded-[14px] border-[1.5px] border-app px-2">
                <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="h-8 w-8 rounded-full bg-brand-50 font-bold text-brand-700">
                  −
                </button>
                <span className="text-sm font-extrabold tabular-nums">{quantity}</span>
                <button type="button" onClick={() => setQuantity((q) => q + 1)} className="h-8 w-8 rounded-full bg-brand-50 font-bold text-brand-700">
                  +
                </button>
              </div>
            </Field>
            <Field label={copy.firstDelivery} htmlFor="sub-date">
              <input
                id="sub-date"
                type="date"
                min={inDays(0)}
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
                className="h-12 w-full rounded-[14px] border-[1.5px] border-app surface px-3.5 text-sm outline-none focus:border-brand-600"
              />
            </Field>
          </div>

          <Field label={copy.frequency} htmlFor="sub-freq">
            <div className="grid grid-cols-3 gap-2.5">
              {FREQS.map((f) => {
                const on = frequency === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequency(f)}
                    aria-pressed={on}
                    className={`rounded-[14px] border-2 px-2 py-3 text-center transition-colors ${on ? 'border-brand-600 bg-brand-50' : 'border-app surface'}`}
                  >
                    <div className="text-[13px] font-extrabold">{t(`subscriptions.freq.${f}`)}</div>
                    <div className="mt-0.5 text-[10.5px] text-muted">{t(`subscriptions.freqSub.${f}`)}</div>
                  </button>
                );
              })}
            </div>
          </Field>

          {addresses.loading ? (
            <Skeleton className="h-14 w-full rounded-xl" />
          ) : primaryAddress ? (
            <div className="rounded-[14px] border border-app px-3.5 py-3 text-[12.5px]">
              <div className="font-extrabold text-muted">{copy.deliverTo}</div>
              <div className="mt-0.5 truncate">{primaryAddress.label} · {primaryAddress.addressLine}</div>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2 rounded-[14px] border border-app px-3.5 py-3">
              <p className="text-[12.5px] text-muted">{copy.noAddress}</p>
              <LinkButton href="/addresses" variant="secondary">{copy.addAddress}</LinkButton>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-[12px] bg-brand-50 px-3.5 py-2.5 text-[12px] font-bold text-brand-800">
            <Percent size={15} weight="fill" />
            {copy.discountNote}
          </div>

          {error && <p className="text-sm font-semibold text-[color:var(--danger)]">{error}</p>}
          <Button type="submit" loading={saving} disabled={!productId || !primaryAddress}>
            {copy.start}
          </Button>
        </form>

        {/* benefits + active */}
        <div className="flex flex-col gap-5">
          <div className="surface rounded-[22px] border border-app p-6">
            <div className="text-base font-extrabold">{copy.benefitsTitle}</div>
            <div className="mt-3.5 flex flex-col gap-3">
              {copy.benefits.map((b, i) => {
                const Ic = BENEFIT_ICONS[i] ?? Percent;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-xl bg-brand-50">
                      <Ic size={18} weight="fill" className="text-brand-600" />
                    </span>
                    <span className="text-[13px] font-semibold text-[#3d565e] dark:text-[color:var(--text)]">{b}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="surface rounded-[22px] border border-app p-6">
            <div className="mb-3 text-base font-extrabold">{copy.activeTitle}</div>
            {subs.loading ? (
              <Skeleton className="h-20 w-full rounded-xl" />
            ) : subs.error ? (
              <ErrorState message={subs.error} onRetry={subs.reload} />
            ) : !subs.data || subs.data.length === 0 ? (
              <p className="text-sm text-muted">{copy.empty}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {subs.data.map((s) => (
                  <div key={s.id} className="rounded-[16px] border border-app p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[14px] font-extrabold">{s.productName}</div>
                      <Chip tone={statusTone[s.status]}>{t(`subscriptions.status.${s.status}`)}</Chip>
                    </div>
                    <div className="mt-1 text-[12.5px] text-muted">
                      {t('subscriptions.perCycle', {
                        qty: s.quantity,
                        unit: s.unit,
                        freq: t(`subscriptions.freq.${s.frequency}`),
                      })}
                    </div>
                    {s.status !== 'CANCELLED' && (
                      <div className="mt-1 text-[12.5px] text-muted">
                        {copy.next}: <span className="font-bold text-[color:var(--text)]">{fmtDate(s.nextDeliveryAt)}</span>
                      </div>
                    )}
                    {s.status !== 'CANCELLED' && (
                      <div className="mt-3 flex gap-2.5">
                        {s.status === 'ACTIVE' ? (
                          <Button variant="secondary" loading={busyId === s.id} onClick={() => act(s.id, 'pause')} className="flex-1">
                            {copy.pause}
                          </Button>
                        ) : (
                          <Button variant="secondary" loading={busyId === s.id} onClick={() => act(s.id, 'resume')} className="flex-1">
                            {copy.resume}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          onClick={() => setCancelId(s.id)}
                          className="flex-1 !text-[color:var(--danger)]"
                        >
                          {copy.cancel}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={cancelId !== null}
        title={copy.cancel}
        message={copy.cancelConfirm}
        confirmLabel={copy.cancel}
        tone="danger"
        loading={busyId !== null}
        onConfirm={() => {
          if (cancelId) act(cancelId, 'cancel');
        }}
        onClose={() => setCancelId(null)}
      />
    </div>
  );
}

export default function SubscriptionsPage() {
  return (
    <RequireAuth>
      <Panel />
    </RequireAuth>
  );
}
