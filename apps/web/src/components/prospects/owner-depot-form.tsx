'use client';

import { useState } from 'react';

import { Button, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import type { ProspectDetail } from '@/lib/types';

import { saveError } from './save-error';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

/** "Ganti depot pemilik" (head office): a depot, or none (back to the opportunity map), with a reason. */
export function OwnerDepotForm({
  row,
  onDone,
  onStale,
  onCancel,
}: {
  row: ProspectDetail;
  onDone: (row: ProspectDetail) => void;
  onStale: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const { depots } = useDepot();
  const [depotId, setDepotId] = useState(row.ownerDepotId ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const why = reason.trim();
    if (why.length < 3 || why.length > 200) {
      setError(t('opsFix.prospects.ownerForm.reasonShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(
        await api.patch<ProspectDetail>(
          endpoints.prospects.ownerDepot(row.id),
          { depotId: depotId || null, reason: why, seenUpdatedAt: row.updatedAt },
          true,
        ),
      );
    } catch (e) {
      const failure = saveError(e, t);
      setStale(failure.stale);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('opsFix.prospects.ownerForm.depot')} htmlFor="prospect-owner-depot">
        <select
          id="prospect-owner-depot"
          className={SELECT}
          value={depotId}
          onChange={(e) => setDepotId(e.target.value)}
        >
          <option value="">{t('opsFix.prospects.ownerForm.toMap')}</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} - {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('opsFix.prospects.ownerForm.reason')} htmlFor="prospect-owner-reason">
        <Input id="prospect-owner-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        {stale ? (
          <Button onClick={onStale}>{t('opsFix.prospects.actions.reload')}</Button>
        ) : (
          <Button loading={busy} onClick={submit}>
            {t('opsFix.prospects.actions.save')}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          {t('opsFix.prospects.actions.cancel')}
        </Button>
      </div>
    </div>
  );
}
