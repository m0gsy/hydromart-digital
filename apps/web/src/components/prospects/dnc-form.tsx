'use client';

import { useState } from 'react';

import { PinField } from '@/components/prospects/pin-field';
import { saveError } from '@/components/prospects/save-error';
import { Button, Card, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { DNC_REASONS, labelKey } from '@/lib/prospect-labels';
import type { Pin } from '@/lib/prospect-pin';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

/** The global do-not-contact list (Manage): a phone, or a business name at a pin. Says what it did, never reads the list back. */
export function DncForm({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState<Pin | null>(null);
  const [reason, setReason] = useState<string>(DNC_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ entries: number; prospects: number } | null>(null);

  async function submit() {
    if (!phone.trim() && !(name.trim() && pin)) return setError(t('opsFix.prospectsField.dnc.needInput'));
    setBusy(true);
    setError(null);
    try {
      setDone(
        await api.post<{ entries: number; prospects: number }>(
          endpoints.prospects.suppress,
          phone.trim()
            ? { phone: phone.trim(), reason }
            : { name: name.trim(), latitude: pin?.lat, longitude: pin?.lng, reason },
          true,
        ),
      );
    } catch (e) {
      setError(saveError(e, t).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4" elevated={false}>
      <h2 className="text-sm font-semibold">{t('opsFix.prospectsField.dnc.title')}</h2>
      <p className="text-xs text-muted">{t('opsFix.prospectsField.dnc.hint')}</p>
      {done ? (
        <p className="text-sm" role="status">
          {t('opsFix.prospectsField.dnc.done', done)}
        </p>
      ) : (
        <>
          <Field label={t('opsFix.prospectsField.dnc.phone')} htmlFor="dnc-phone">
            <Input id="dnc-phone" type="tel" inputMode="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('opsFix.prospectsField.dnc.name')} htmlFor="dnc-name">
            <Input id="dnc-name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!phone.trim() && <PinField pin={pin} onPin={setPin} />}
          <Field label={t('opsFix.prospectsField.dnc.reason')} htmlFor="dnc-reason">
            <select id="dnc-reason" className={SELECT} value={reason} onChange={(e) => setReason(e.target.value)}>
              {DNC_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(labelKey('dnc', r))}
                </option>
              ))}
            </select>
          </Field>
          <FormError message={error} />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!done && (
          <Button variant="danger" loading={busy} onClick={submit}>
            {t('opsFix.prospectsField.dnc.submit')}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t('opsFix.prospectsField.dnc.cancel')}
        </Button>
      </div>
    </Card>
  );
}
