'use client';

import { useMemo, useState } from 'react';
import { ArrowsClockwise, BellSlash, Pause, Percent, Truck } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { ConfirmDialog } from '@/components/overlay';
import {
  Button,
  Chip,
  ErrorState,
  Field,
  FormError,
  LinkButton,
  LoadError,
  Skeleton,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { dateInDaysWib } from '@/lib/wib';
import { useAsync } from '@/lib/use-async';
import { subscriptions as subID } from '@/lib/dictionaries/id/subscriptions';
import { subscriptions as subEN } from '@/lib/dictionaries/en/subscriptions';
import type {
  Address,
  NearbyDepot,
  Page as Paged,
  Product,
  Subscription,
  SubscriptionFrequency,
} from '@/lib/types';

const FREQS: SubscriptionFrequency[] = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'];
const BENEFIT_ICONS = [Percent, Truck, BellSlash, Pause];

function Panel() {
  const { t, locale } = useT();
  const { toast } = useToast();
  const copy = locale === 'en' ? subEN : subID;

  const products = useAsync<Paged<Product>>(() =>
    api.get(endpoints.products.browse({ limit: 50 })),
  );
  const addresses = useAsync<Address[]>(() => api.get(endpoints.addresses.list, true));
  const subs = useAsync<Subscription[]>(() => api.get(endpoints.subscriptions.list, true));
  const primaryAddress = useMemo(
    () => addresses.data?.find((a) => a.isPrimary) ?? addresses.data?.[0] ?? null,
    [addresses.data],
  );
  /*
   * K1.9. The plan used to be locked to whichever address happened to be primary: no
   * picker here, no way to change it afterwards, and switching your primary address did
   * not move it. Somebody who moved house could only cancel and start again.
   *
   * `null` means "not chosen yet", which falls through to primary — so the default is
   * exactly what it always was and only a deliberate pick changes it.
   */
  const [addressId, setAddressId] = useState<string | null>(null);
  const chosenAddress = useMemo(
    () => addresses.data?.find((a) => a.id === addressId) ?? primaryAddress,
    [addresses.data, addressId, primaryAddress],
  );

  /**
   * D7: the saving is quoted against the depot that will actually be CHARGED — the one the
   * subscription's saved address routes to — not the one behind wherever the shopper
   * happens to be browsing.
   *
   * Those are two different depots with two different rates and nothing reconciling them:
   * a customer standing near a depot that gives 10% was quoted 10% and billed the 5% their
   * home depot gives, on every delivery, forever. The sweep prices from
   * `resolveDepot(address)`; this asks the same question the same way checkout does.
   *
   * An address with no map pin cannot be routed by anybody, so the quote falls back to the
   * global default — which is exactly what the sweep would refuse to place against, and the
   * form says so separately.
   */
  const nearby = useAsync<NearbyDepot[]>(
    () =>
      chosenAddress?.latitude != null && chosenAddress?.longitude != null
        ? api.get(
            endpoints.depots.nearby({
              lat: chosenAddress.latitude,
              lng: chosenAddress.longitude,
              limit: 1,
            }),
            true,
          )
        : Promise.resolve([]),
    [chosenAddress?.latitude, chosenAddress?.longitude],
  );
  const depotId = nearby.data?.[0]?.id ?? null;
  const discount = useAsync<{ rate: number }>(
    () => api.get(endpoints.subscriptions.discount(depotId)),
    [depotId],
  );
  const discountPct = Math.round((discount.data?.rate ?? 0) * 100);

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(2);
  const [frequency, setFrequency] = useState<SubscriptionFrequency>('WEEKLY');
  const [firstDate, setFirstDate] = useState(dateInDaysWib(1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !chosenAddress) return;
    setSaving(true);
    setError(null);
    try {
      const a = chosenAddress;
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

  /**
   * K1.9. Moving a standing plan to another saved address.
   *
   * A write the customer makes, never a side effect of editing the address book: the plan
   * holds its own snapshot on purpose, because the sweep prices against the depot that
   * snapshot routes to (D7). An address edit that silently re-routed a standing order
   * would also silently change what it costs.
   */
  async function moveAddress(id: string, next: Address) {
    setBusyId(id);
    try {
      await api.post(
        endpoints.subscriptions.address(id),
        {
          deliveryAddress: {
            recipientName: next.recipientName,
            phone: next.phone,
            addressLine: next.addressLine,
            city: next.city,
            province: next.province,
            postalCode: next.postalCode,
            latitude: next.latitude,
            longitude: next.longitude,
          },
        },
        true,
      );
      toast(copy.addressMoved, 'success');
      subs.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : copy.addressMoveError, 'error');
    } finally {
      setBusyId(null);
    }
  }

  /*
   * H9. This had `try/finally` and NO catch, so a refusal escaped as an unhandled promise
   * rejection: nothing on screen changed, nothing was said, and the row snapped back
   * looking exactly like a tap that had not registered. Pausing and cancelling a standing
   * order are the two actions on this screen that decide whether water arrives — a silent
   * refusal on either is the customer believing they stopped something they did not.
   */
  async function act(id: string, action: 'pause' | 'resume' | 'cancel') {
    setBusyId(id);
    try {
      await api.post(endpoints.subscriptions[action](id), {}, true);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : copy.actionError, 'error');
    } finally {
      subs.reload();
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
      <h1 className="mb-5 hidden text-[28px] font-extrabold tracking-[-0.03em] sm:block">
        {copy.title}
      </h1>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* setup */}
        <form
          onSubmit={create}
          className="surface flex flex-col gap-4 rounded-[22px] border border-app p-6"
        >
          <div>
            <Chip tone="tint">
              <ArrowsClockwise size={14} weight="fill" /> {copy.title}
            </Chip>
            <div className="mt-3 text-[22px] font-extrabold tracking-[-0.02em]">
              {copy.setupHeading}
            </div>
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
            {/* The select is `required`, so an unread catalogue is a form that cannot be
                submitted and does not say why. */}
            {products.error && <LoadError onRetry={products.reload} />}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={copy.quantity} htmlFor="sub-qty">
              <div className="flex h-12 items-center justify-between rounded-[14px] border-[1.5px] border-app px-2">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="h-11 w-11 rounded-full bg-brand-50 font-bold text-brand-700"
                >
                  −
                </button>
                <span className="text-sm font-extrabold tabular-nums">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="h-11 w-11 rounded-full bg-brand-50 font-bold text-brand-700"
                >
                  +
                </button>
              </div>
            </Field>
            <Field label={copy.firstDelivery} htmlFor="sub-date">
              <input
                id="sub-date"
                type="date"
                min={dateInDaysWib(0)}
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
                    <div className="mt-0.5 text-[10.5px] text-muted">
                      {t(`subscriptions.freqSub.${f}`)}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          {addresses.loading ? (
            <Skeleton className="h-14 w-full rounded-xl" />
          ) : addresses.error ? (
            /* "Belum ada alamat" sends a shopper who HAS one off to add a duplicate, and the
               submit button stays disabled either way. Say the read failed. */
            <LoadError
              onRetry={addresses.reload}
              className="rounded-[14px] border border-app px-3.5 py-3"
            />
          ) : chosenAddress ? (
            /* K1.9. A select rather than a read-only line: one saved address is still one
               option, and a select with one option reads honestly as "this one". */
            <Field label={copy.deliverTo} htmlFor="sub-address" hint={copy.addressIsSnapshot}>
              <select
                id="sub-address"
                value={chosenAddress.id}
                onChange={(e) => setAddressId(e.target.value)}
                className="h-12 w-full rounded-[14px] border-[1.5px] border-app surface px-3.5 text-sm outline-none focus:border-brand-600"
              >
                {(addresses.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.addressLine}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="flex flex-col items-start gap-2 rounded-[14px] border border-app px-3.5 py-3">
              <p className="text-[12.5px] text-muted">{copy.noAddress}</p>
              <LinkButton href="/addresses" variant="secondary">
                {copy.addAddress}
              </LinkButton>
            </div>
          )}

          {/*
            K1.10. `?? 0` made three different states look like one: the discount is genuinely
            zero, the read failed, and no depot could be resolved all rendered as an absent
            banner — which a shopper reads as "this depot gives no discount". Two of those
            three are wrong, and the wrong one costs the customer the reason they are on this
            screen. The failure now says so, and says the discount still applies.
          */}
          {discount.error ? (
            <div className="rounded-[12px] border border-app px-3.5 py-2.5 text-[12px] text-muted">
              {copy.discountUnknown}
            </div>
          ) : (
            discountPct > 0 && (
              <div className="flex items-center gap-2 rounded-[12px] bg-brand-50 px-3.5 py-2.5 text-[12px] font-bold text-brand-800">
                <Percent size={15} weight="fill" />
                {copy.discountNote.replace('{pct}', String(discountPct))}
              </div>
            )
          )}

          <FormError message={error} />
          <Button type="submit" loading={saving} disabled={!productId || !chosenAddress}>
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
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50">
                      <Ic size={18} weight="fill" className="text-brand-600" />
                    </span>
                    <span className="text-[13px] font-semibold text-[#3d565e] dark:text-[color:var(--text)]">
                      {b}
                    </span>
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
                      <Chip tone={statusTone[s.status]}>
                        {t(`subscriptions.status.${s.status}`)}
                      </Chip>
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
                        {copy.next}:{' '}
                        <span className="font-bold text-[color:var(--text)]">
                          {fmtDate(s.nextDeliveryAt)}
                        </span>
                      </div>
                    )}
                    {/*
                      D3: a plan whose saved address has no map pin can never be routed to a
                      depot, so the sweep skips it every tick and the schedule never moves.
                      It sat here reading "Aktif", next-delivery date frozen in the past,
                      delivering nothing and explaining nothing. New ones are refused at
                      creation; the ones already sitting here say why.
                    */}
                    {s.status !== 'CANCELLED' && (s.latitude == null || s.longitude == null) && (
                      <div className="mt-2 rounded-xl bg-[color:var(--danger-bg)] px-3 py-2 text-[12px] font-semibold text-[color:var(--danger)]">
                        {t('customerFix.subscriptionUnroutable')}
                      </div>
                    )}
                    {/*
                      K1.9. The plan's own address, and the only place it can be changed.
                      Shown even for one saved address, because the line is also the answer
                      to "where is this going?" — which nothing on this card used to say.
                    */}
                    {s.status !== 'CANCELLED' && (addresses.data ?? []).length > 0 && (
                      <div className="mt-2">
                        <label
                          className="text-[11px] font-extrabold uppercase tracking-wide text-muted"
                          htmlFor={`sub-addr-${s.id}`}
                        >
                          {copy.deliverTo}
                        </label>
                        <select
                          id={`sub-addr-${s.id}`}
                          value={
                            (addresses.data ?? []).find((a) => a.addressLine === s.addressLine)
                              ?.id ?? ''
                          }
                          disabled={busyId === s.id}
                          onChange={(e) => {
                            const next = (addresses.data ?? []).find(
                              (a) => a.id === e.target.value,
                            );
                            if (next) void moveAddress(s.id, next);
                          }}
                          className="mt-1 h-11 w-full rounded-[12px] border-[1.5px] border-app surface px-3 text-[12.5px] outline-none focus:border-brand-600"
                        >
                          {/* The plan's saved line may not match any current address book
                              entry — it is a snapshot, and the entry can have been edited or
                              deleted since. Naming it keeps the select honest. */}
                          <option value="">{s.addressLine}</option>
                          {(addresses.data ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label} · {a.addressLine}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {s.status !== 'CANCELLED' && (
                      <div className="mt-3 flex gap-2.5">
                        {s.status === 'ACTIVE' ? (
                          <Button
                            variant="secondary"
                            loading={busyId === s.id}
                            onClick={() => act(s.id, 'pause')}
                            className="flex-1"
                          >
                            {copy.pause}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            loading={busyId === s.id}
                            onClick={() => act(s.id, 'resume')}
                            className="flex-1"
                          >
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
