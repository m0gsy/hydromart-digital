'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { Button, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { Address, Order } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

const select =
  'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600';

/**
 * Owner decision 2026-11-20: the customer moves an order to another saved address before it
 * is prepared. Only an address the order's own depot serves — same prices, same payment —
 * which the server checks; this sheet says so up front and shows the refusal when it comes.
 */
export function ChangeAddressSheet({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const book = useAsync<Address[]>(() => api.get(endpoints.addresses.list, true), []);
  const choices = (book.data ?? []).filter((a) => a.latitude != null && a.longitude != null);
  const [picked, setPicked] = useState('');
  const chosen = choices.find((a) => a.id === (picked || choices[0]?.id)) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.orders.changeAddress(order.id),
        {
          deliveryAddress: {
            recipientName: chosen.recipientName,
            phone: chosen.phone,
            addressLine: chosen.addressLine,
            city: chosen.city,
            latitude: chosen.latitude,
            longitude: chosen.longitude,
            notes: chosen.notes || undefined,
          },
        },
        true,
      );
      toast(t('order.toast.addressChanged'));
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('order.detail.changeAddressError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('order.detail.changeAddressTitle')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('order.detail.changeAddressIntro')}</p>
        {book.loading ? (
          <Skeleton className="h-16 w-full" />
        ) : choices.length === 0 ? (
          <p className="text-sm text-muted">
            {t('order.detail.changeAddressEmpty')}{' '}
            <Link href="/addresses" className="font-bold text-brand-700 underline">
              {t('order.detail.changeAddressManage')}
            </Link>
          </p>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            {t('order.detail.changeAddressPick')}
            <select
              className={select}
              value={chosen?.id ?? ''}
              onChange={(e) => setPicked(e.target.value)}
            >
              {choices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.addressLine}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
        <Button onClick={save} loading={busy} disabled={!chosen} className="rounded-full">
          {t('order.detail.changeAddressSave')}
        </Button>
      </div>
    </Sheet>
  );
}
