'use client';

import { useState } from 'react';

import { Button, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { labelKey } from '@/lib/prospect-labels';
import { statusTargets } from '@/lib/prospect-status';
import type { ProspectDetail, ProspectStatus } from '@/lib/types';

import { saveError } from './save-error';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

/** "Ubah tahap": moves the prospect along; LOST asks why. Sends the version it read (409 when stale). */
export function StatusForm({
  row,
  manage,
  onDone,
  onStale,
  onCancel,
}: {
  row: ProspectDetail;
  manage: boolean;
  onDone: (row: ProspectDetail) => void;
  onStale: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const targets = statusTargets(row.status, manage);
  const [to, setTo] = useState<ProspectStatus>(targets[0] as ProspectStatus);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const lost = reason.trim();
    if (to === 'LOST' && (lost.length < 3 || lost.length > 200)) {
      setError(t('opsFix.prospects.statusForm.lostReasonShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<ProspectDetail>(
        endpoints.prospects.status(row.id),
        { status: to, ...(to === 'LOST' && { lostReason: lost }), seenUpdatedAt: row.updatedAt },
        true,
      );
      onDone(updated);
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
      <Field label={t('opsFix.prospects.statusForm.target')} htmlFor="prospect-status-to">
        <select
          id="prospect-status-to"
          className={SELECT}
          value={to}
          onChange={(e) => setTo(e.target.value as ProspectStatus)}
        >
          {targets.map((s) => (
            <option key={s} value={s}>
              {t(labelKey('status', s))}
            </option>
          ))}
        </select>
      </Field>
      {to === 'LOST' && (
        <Field label={t('opsFix.prospects.statusForm.lostReason')} htmlFor="prospect-lost-reason">
          <Input
            id="prospect-lost-reason"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      )}
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
