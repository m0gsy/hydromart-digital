'use client';

import { useState } from 'react';

import { Button, Field, FormError, Input } from '@/components/ui';
import { currentPosition, GeoError } from '@/lib/geo';
import { useT } from '@/lib/locale-context';
import { parsePin, validPin, type Pin } from '@/lib/prospect-pin';

/**
 * Where the business is: "Pakai lokasi saya" (the address-pin GPS, with the accuracy it got) or a
 * pasted "lat, lng". Reports a valid pin or null, never a (0, 0).
 */
export function PinField({ pin, onPin }: { pin: Pin | null; onPin: (pin: Pin | null) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function useGps() {
    setBusy(true);
    setError(null);
    try {
      const { coords } = await currentPosition({ pin: true });
      if (!validPin(coords.latitude, coords.longitude)) throw new GeoError('unavailable');
      setAccuracy(Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null);
      setText('');
      onPin({ lat: coords.latitude, lng: coords.longitude });
    } catch (e) {
      setError(e instanceof GeoError ? t(`errors.geo.${e.reason}`) : t('opsFix.prospectsField.pin.unavailable'));
    } finally {
      setBusy(false);
    }
  }

  function paste(value: string) {
    setText(value);
    setAccuracy(null);
    const parsed = parsePin(value);
    setError(value.trim() && !parsed ? t('opsFix.prospectsField.pin.bad') : null);
    onPin(parsed);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" loading={busy} onClick={useGps}>
        {busy ? t('opsFix.prospectsField.pin.locating') : t('opsFix.prospectsField.pin.use')}
      </Button>
      <Field label={t('opsFix.prospectsField.pin.paste')} htmlFor="prospect-pin-paste">
        <Input
          id="prospect-pin-paste"
          inputMode="decimal"
          placeholder={t('opsFix.prospectsField.pin.pastePlaceholder')}
          value={text}
          onChange={(e) => paste(e.target.value)}
        />
      </Field>
      {pin && (
        <p className="text-xs text-muted" role="status">
          {accuracy === null
            ? t('opsFix.prospectsField.pin.fromPaste')
            : t('opsFix.prospectsField.pin.fromGps', { m: accuracy })}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
