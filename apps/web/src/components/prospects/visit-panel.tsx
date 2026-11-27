'use client';

import { useEffect, useState } from 'react';

import { PreciseLocationNotice } from '@/components/hr/precise-location-notice';
import { useToast } from '@/components/toast';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { currentPosition, GeoError } from '@/lib/geo';
import { useT } from '@/lib/locale-context';
import { labelKey, PROSPECT_OUTCOMES } from '@/lib/prospect-labels';
import type { ProspectDetail, ProspectVisitResult } from '@/lib/types';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

/**
 * GPS check-in at the prospect. Same proof rules as the other presence checks: a precise fix with a
 * stated accuracy, no figure no call. It is never queued offline (the proof must be live), and the
 * server's refusal text is shown as it is: it IS the guidance (approximate fix, too far).
 */
export function VisitPanel({
  row,
  onDone,
  onStale,
}: {
  row: ProspectDetail;
  onDone: (row: ProspectDetail) => void;
  onStale: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<string>(PROSPECT_OUTCOMES[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A failed check-in moves focus to its message, so a screen reader hears why.
  useEffect(() => {
    if (error) document.getElementById('prospect-visit-error')?.focus();
  }, [error]);

  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      const { coords } = await currentPosition({ precise: true });
      // The server needs the fix's accuracy to apply its "Perkiraan" rule: no figure, no check-in.
      if (!Number.isFinite(coords.accuracy) || coords.accuracy < 0)
        throw new GeoError('unavailable');
      const res = await api.post<ProspectVisitResult>(
        endpoints.prospects.visit(row.id),
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyM: Math.round(coords.accuracy),
          outcome,
          ...(note.trim() && { note: note.trim() }),
        },
        true,
      );
      toast(t('opsFix.prospectsField.visit.saved'), 'success');
      setNote('');
      onDone(res.prospect);
    } catch (e) {
      if (e instanceof GeoError) setError(t(`errors.geo.${e.reason}`));
      else if (e instanceof ApiError && e.status === 409) {
        setError(t('opsFix.prospectsField.visit.changed'));
        onStale();
      } else if (e instanceof ApiError)
        setError(e.message || t('opsFix.prospectsField.visit.failed'));
      else setError(t('opsFix.prospectsField.visit.networkFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{t('opsFix.prospectsField.visit.title')}</h2>
      <PreciseLocationNotice />
      <p className="text-xs text-muted">{t('opsFix.prospectsField.visit.hint')}</p>
      <Field label={t('opsFix.prospectsField.visit.outcome')} htmlFor="prospect-visit-outcome">
        <select
          id="prospect-visit-outcome"
          className={SELECT}
          value={outcome}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'prospect-visit-error' : undefined}
          onChange={(e) => setOutcome(e.target.value)}
        >
          {PROSPECT_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t(labelKey('outcome', o))}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('opsFix.prospectsField.visit.note')} htmlFor="prospect-visit-note">
        <Input
          id="prospect-visit-note"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <FormError id="prospect-visit-error" message={error} />
      <Button className="w-full sm:w-auto" loading={busy} onClick={checkIn}>
        {busy ? t('opsFix.prospectsField.visit.locating') : t('opsFix.prospectsField.visit.begin')}
      </Button>
    </div>
  );
}
