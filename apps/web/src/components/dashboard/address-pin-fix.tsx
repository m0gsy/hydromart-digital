'use client';

import { useState } from 'react';

import { ExternalLink } from '@/components/external-link';
import { useToast } from '@/components/toast';
import { Button, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { PodPinHint } from '@/lib/pod-pin';
import type { DepotCustomerAddress } from '@/lib/types';

/**
 * P2-2. Where a customer's door is, on the depot's customer card, and the way to fix it.
 *
 * A courier who found the house knows better than a GPS fix taken indoors, and a pin decides
 * which depot every order and subscription of that address routes to. Staff paste
 * coordinates or a Google Maps link; customer-service reads it with the same parser the
 * imports use, checks the customer is this depot's own, and records the pin it replaced.
 */
export function AddressPinFix({
  customerId,
  depotId,
  address,
  canFix,
  onSaved,
  hint,
}: {
  customerId: string;
  depotId: string;
  address: DepotCustomerAddress;
  /** depotCrmWrite: HR reads the card but never writes it. */
  canFix: boolean;
  onSaved: () => void;
  /** P2-4: where couriers actually handed over, when that is clearly not the pin. */
  hint?: PodPinHint | null;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinned = address.latitude != null && address.longitude != null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await saveLocation(text.trim())) {
      setOpen(false);
      setText('');
    }
  }

  async function saveLocation(location: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        endpoints.depotCrm.addressLocation(customerId, address.id),
        // CA-2-53: the version this card showed; the server refuses (409) if it moved.
        { depotId, location, seenUpdatedAt: address.updatedAt },
        true,
      );
      toast(t('dashA.customerDetail.pinSaved'), 'success');
      onSaved();
      return true;
    } catch (err) {
      // The server says what to do with a short link or a half pin, in Indonesian.
      setError(err instanceof ApiError ? err.message : t('dashA.customerDetail.pinFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {pinned ? (
          <ExternalLink
            href={`https://www.google.com/maps/search/?api=1&query=${address.latitude},${address.longitude}`}
            className="font-semibold text-brand-600 underline"
          >
            {t('dashA.customerDetail.pinView')}
          </ExternalLink>
        ) : (
          <span className="font-semibold text-[color:var(--warning)]">
            {t('dashA.customerDetail.pinNone')}
          </span>
        )}
        {canFix && (
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
              setError(null);
            }}
            aria-expanded={open}
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            {t('dashA.customerDetail.pinFix')}
          </button>
        )}
      </div>
      {canFix && hint && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[color:var(--warning-bg)] px-2.5 py-1.5">
          <span className="font-medium text-[color:var(--warning)]">
            {hint.distanceM != null
              ? t('dashA.customerDetail.podOff', { m: hint.distanceM })
              : t('dashA.customerDetail.podNoPin')}
          </span>
          <ExternalLink
            href={`https://www.google.com/maps/search/?api=1&query=${hint.latitude},${hint.longitude}`}
            className="font-semibold text-brand-600 underline"
          >
            {t('dashA.customerDetail.pinView')}
          </ExternalLink>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              saveLocation(`${hint.latitude.toFixed(7)}, ${hint.longitude.toFixed(7)}`)
            }
            className="font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60"
          >
            {t('dashA.customerDetail.podUse')}
          </button>
        </div>
      )}
      {open && (
        <form onSubmit={save} className="flex flex-col gap-1.5 sm:flex-row">
          <Input
            aria-label={t('dashA.customerDetail.pinHint')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('dashA.customerDetail.pinHint')}
            maxLength={2048}
            className="flex-1"
          />
          <Button type="submit" loading={busy} disabled={!text.trim()} className="rounded-full">
            {t('dashA.customerDetail.pinSave')}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="font-medium text-[color:var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
