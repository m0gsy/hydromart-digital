'use client';

import { useState } from 'react';

import { ExternalLink } from '@/components/external-link';
import { useToast } from '@/components/toast';
import { Button, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
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
}: {
  customerId: string;
  depotId: string;
  address: DepotCustomerAddress;
  /** depotCrmWrite: HR reads the card but never writes it. */
  canFix: boolean;
  onSaved: () => void;
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
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        endpoints.depotCrm.addressLocation(customerId, address.id),
        // CA-2-53: the version this card showed; the server refuses (409) if it moved.
        { depotId, location: text.trim(), seenUpdatedAt: address.updatedAt },
        true,
      );
      toast(t('dashA.customerDetail.pinSaved'), 'success');
      setOpen(false);
      setText('');
      onSaved();
    } catch (err) {
      // The server says what to do with a short link or a half pin, in Indonesian.
      setError(err instanceof ApiError ? err.message : t('dashA.customerDetail.pinFailed'));
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
