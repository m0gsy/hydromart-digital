'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { addressToForm, pickDefaultAddress } from '@/lib/addresses';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Address, Cart, LoyaltyAccount, Order, PaymentMethod, VoucherQuote } from '@/lib/types';

const METHODS: { value: PaymentMethod; label: string; hint: string }[] = [
  { value: 'CASH', label: 'Cash on delivery', hint: 'Pay the driver when your order arrives.' },
  { value: 'TRANSFER', label: 'Bank transfer', hint: 'Transfer manually, confirmed by the depot.' },
  { value: 'QRIS', label: 'QRIS', hint: 'Scan to pay with any QRIS app.' },
  { value: 'EWALLET', label: 'E-wallet', hint: 'GoPay, OVO, DANA, and more.' },
  { value: 'VA', label: 'Virtual account', hint: 'Pay to a one-time bank account number.' },
];

function CheckoutInner() {
  const router = useRouter();
  const { customer } = useAuth();
  const { data: cart, error, loading, reload } = useAsync<Cart>(() =>
    api.get(endpoints.cart.view, true),
  );
  // Non-blocking: the membership discount is a bonus preview. If loyalty is down
  // the customer still checks out (order-service applies the tier discount itself,
  // fail-open). rate 0 on any error.
  const { data: loyalty } = useAsync<LoyaltyAccount>(() => api.get(endpoints.loyalty.me, true));
  // Saved address book. Fail-soft: if this can't load, the customer just types a fresh
  // address (as before) — never blocks checkout, so the load error is intentionally ignored.
  const { data: savedAddresses } = useAsync<Address[]>(() =>
    api.get(endpoints.addresses.list, true),
  );

  const [voucherCode, setVoucherCode] = useState('');
  const [quote, setQuote] = useState<VoucherQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  const [form, setForm] = useState({
    recipientName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    addressLine: '',
    city: '',
    province: '',
    postalCode: '',
    notes: '',
  });
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // `null` = a fresh manually-typed address (no saved coordinates). Selecting a saved
  // address stashes its lat/lng, which lets order-service route the order to a depot
  // (per-depot pricing, delivery fee, stock reservation) — a manual address has none.
  const [selection, setSelection] = useState<'new' | string | null>(null);
  const [saveToBook, setSaveToBook] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [coords, setCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  // Preselect the primary saved address (else the first) the first time the book loads.
  useEffect(() => {
    if (selection !== null || !savedAddresses || savedAddresses.length === 0) return;
    const preferred = pickDefaultAddress(savedAddresses);
    if (preferred) {
      setSelection(preferred.id);
      setForm((f) => ({ ...f, ...addressToForm(preferred) }));
      setCoords({ latitude: preferred.latitude, longitude: preferred.longitude });
    }
  }, [savedAddresses, selection]);

  function chooseSaved(address: Address) {
    setSelection(address.id);
    setForm((f) => ({ ...f, ...addressToForm(address) }));
    setCoords({ latitude: address.latitude, longitude: address.longitude });
  }

  function chooseNew() {
    setSelection('new');
    setCoords({ latitude: null, longitude: null });
    setForm({
      recipientName: customer?.fullName ?? '',
      phone: customer?.phone ?? '',
      addressLine: '',
      city: '',
      province: '',
      postalCode: '',
      notes: '',
    });
  }

  // Editing an address field detaches from the saved coordinates (they no longer match).
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (k !== 'notes') setCoords({ latitude: null, longitude: null });
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function applyVoucher() {
    if (!cart || !voucherCode.trim()) return;
    setQuoting(true);
    setVoucherError(null);
    setQuote(null);
    try {
      const result = await api.post<VoucherQuote>(
        endpoints.vouchers.quote,
        { code: voucherCode.trim(), subtotal: cart.subtotal },
        true,
      );
      setQuote(result);
    } catch (err) {
      setVoucherError(err instanceof ApiError ? err.message : 'That voucher could not be applied.');
    } finally {
      setQuoting(false);
    }
  }

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const order = await api.post<Order>(
        endpoints.orders.checkout,
        {
          deliveryAddress: {
            recipientName: form.recipientName,
            phone: form.phone,
            addressLine: form.addressLine,
            city: form.city,
            province: form.province,
            postalCode: form.postalCode || undefined,
            latitude: coords.latitude ?? undefined,
            longitude: coords.longitude ?? undefined,
            notes: form.notes || undefined,
          },
          // order-service re-validates the voucher (fail-closed) and applies the
          // membership discount itself; sending the raw code is enough.
          voucherCode: voucherCode.trim() || undefined,
        },
        true,
      );
      // Save a fresh address to the book (non-blocking) so it's reusable next time.
      if (saveToBook && !savedAddresses?.some((a) => a.id === selection)) {
        try {
          await api.post(
            endpoints.addresses.create,
            {
              label: saveLabel.trim() || 'Alamat',
              recipientName: form.recipientName,
              phone: form.phone,
              addressLine: form.addressLine,
              city: form.city,
              province: form.province,
              postalCode: form.postalCode || undefined,
            },
            true,
          );
        } catch {
          /* the order is placed; a failed address save must not block the flow */
        }
      }
      // Initiate payment for the placed order; failure here still leaves a valid
      // order the customer can pay from the order page, so we don't hard-block.
      try {
        await api.post(
          endpoints.payments.initiate,
          { orderId: order.id, method, amount: order.total },
          true,
        );
      } catch {
        /* order exists; payment can be retried on the order page */
      }
      router.replace(`/orders/${order.id}`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not place your order.');
      setSubmitting(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!cart || cart.items.length === 0) {
    return <ErrorState message="Your cart is empty. Add products before checking out." />;
  }

  const isSavedSelection = savedAddresses?.some((a) => a.id === selection) ?? false;

  // Preview only — order-service computes the authoritative discount at checkout.
  const membershipRate = loyalty?.discountRate ?? 0;
  const membershipDiscount = Math.floor(cart.subtotal * membershipRate);
  const voucherDiscount = quote?.discount ?? 0;
  const totalDiscount = Math.min(cart.subtotal, membershipDiscount + voucherDiscount);
  const estimatedTotal = cart.subtotal - totalDiscount;

  return (
    <form onSubmit={placeOrder} className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Checkout</h1>

      {savedAddresses && savedAddresses.length > 0 && (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="font-semibold">Deliver to</h2>
          <div className="flex flex-col gap-2">
            {savedAddresses.map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  selection === a.id ? 'border-brand-600 bg-brand-50' : 'border-app'
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  checked={selection === a.id}
                  onChange={() => chooseSaved(a)}
                  className="mt-1 accent-brand-600"
                />
                <span>
                  <span className="block text-sm font-semibold">
                    {a.label}
                    {a.isPrimary && <span className="text-muted"> · Primary</span>}
                  </span>
                  <span className="block text-xs text-muted">
                    {a.recipientName} — {a.addressLine}, {a.city}
                  </span>
                </span>
              </label>
            ))}
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                selection === 'new' ? 'border-brand-600 bg-brand-50' : 'border-app'
              }`}
            >
              <input
                type="radio"
                name="address"
                checked={selection === 'new'}
                onChange={chooseNew}
                className="accent-brand-600"
              />
              <span className="text-sm font-semibold">Use a new address</span>
            </label>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-4">
        <h2 className="font-semibold">Delivery address</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recipient name" htmlFor="recipientName">
            <Input id="recipientName" required value={form.recipientName} onChange={set('recipientName')} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" required value={form.phone} onChange={set('phone')} inputMode="tel" />
          </Field>
        </div>
        <Field label="Address" htmlFor="addressLine">
          <Input id="addressLine" required value={form.addressLine} onChange={set('addressLine')} placeholder="Street, number, RT/RW" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" htmlFor="city">
            <Input id="city" required value={form.city} onChange={set('city')} />
          </Field>
          <Field label="Province" htmlFor="province">
            <Input id="province" required value={form.province} onChange={set('province')} />
          </Field>
          <Field label="Postal code" htmlFor="postalCode" hint="Optional">
            <Input id="postalCode" value={form.postalCode} onChange={set('postalCode')} inputMode="numeric" />
          </Field>
        </div>
        <Field label="Notes for the driver" htmlFor="notes" hint="Optional">
          <Input id="notes" value={form.notes} onChange={set('notes')} placeholder="e.g. leave with the guard" />
        </Field>
        {!isSavedSelection && (
          <div className="flex flex-col gap-2 border-t border-app pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveToBook}
                onChange={(e) => setSaveToBook(e.target.checked)}
                className="accent-brand-600"
              />
              Save this address to my address book
            </label>
            {saveToBook && (
              <Field label="Address label" htmlFor="saveLabel" hint="e.g. Home, Office">
                <Input
                  id="saveLabel"
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                  placeholder="Rumah"
                  maxLength={50}
                />
              </Field>
            )}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold">Payment method</h2>
        <div className="flex flex-col gap-2">
          {METHODS.map((m) => (
            <label
              key={m.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                method === m.value ? 'border-brand-600 bg-brand-50' : 'border-app'
              }`}
            >
              <input
                type="radio"
                name="method"
                value={m.value}
                checked={method === m.value}
                onChange={() => setMethod(m.value)}
                className="mt-1 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-muted">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold">Voucher</h2>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Voucher code"
            value={voucherCode}
            onChange={(e) => {
              setVoucherCode(e.target.value.toUpperCase());
              setQuote(null);
              setVoucherError(null);
            }}
            placeholder="e.g. HEMAT10"
            autoCapitalize="characters"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={applyVoucher}
            loading={quoting}
            disabled={!voucherCode.trim()}
          >
            Apply
          </Button>
        </div>
        {quote && (
          <p className="text-sm font-medium text-green-700" role="status">
            Voucher {quote.code} applied — <Money amount={quote.discount} /> off.
          </p>
        )}
        {voucherError && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {voucherError}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Subtotal</span>
          <Money amount={cart.subtotal} />
        </div>
        {membershipDiscount > 0 && (
          <div className="flex justify-between text-sm text-green-700">
            <span>Member discount ({Math.round(membershipRate * 100)}%)</span>
            <span>
              −<Money amount={membershipDiscount} />
            </span>
          </div>
        )}
        {voucherDiscount > 0 && (
          <div className="flex justify-between text-sm text-green-700">
            <span>Voucher {quote?.code}</span>
            <span>
              −<Money amount={voucherDiscount} />
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-app pt-2 font-semibold">
          <span>Estimated total</span>
          <Money amount={estimatedTotal} />
        </div>
        <p className="text-xs text-muted">Delivery fee is added to the total once your depot is assigned.</p>
      </Card>

      {submitError && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {submitError}
        </p>
      )}

      <Button type="submit" loading={submitting} className="w-full">
        Place order
      </Button>
    </form>
  );
}

export default function CheckoutPage() {
  return (
    <RequireAuth>
      <CheckoutInner />
    </RequireAuth>
  );
}
