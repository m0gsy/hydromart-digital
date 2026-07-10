'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Cart, Order, PaymentMethod } from '@/lib/types';

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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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
            notes: form.notes || undefined,
          },
        },
        true,
      );
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

  return (
    <form onSubmit={placeOrder} className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Checkout</h1>

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

      <Card className="flex flex-col gap-2 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Subtotal</span>
          <Money amount={cart.subtotal} />
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
