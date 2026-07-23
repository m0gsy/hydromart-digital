'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, CalendarCheck } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

// value = the slot label stored on the delivery (kept stable); label is translated.
const SLOTS = [
  { key: 'morning', value: 'Pagi (09:00–12:00)' },
  { key: 'afternoon', value: 'Siang (12:00–15:00)' },
  { key: 'evening', value: 'Sore (15:00–18:00)' },
] as const;

function Reschedule() {
  const router = useRouter();
  const { t } = useT();
  const id = String(useParams().id);
  const [when, setWhen] = useState('');
  const [slot, setSlot] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!when) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        endpoints.deliveries.driver.reschedule(id),
        { rescheduledFor: new Date(when).toISOString(), slot: slot || undefined, note: note || undefined },
        true,
      );
      router.replace('/driver');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('driver.reschedule.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-extrabold">{t('driver.reschedule.title')}</div>
      </header>

      <Card className="space-y-4 p-4">
        <Field label={t('driver.reschedule.whenLabel')} htmlFor="when">
          <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label={t('driver.reschedule.slotLabel')}>
          <div className="flex flex-wrap gap-2">
            {SLOTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSlot(s.value === slot ? '' : s.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${s.value === slot ? 'bg-brand-600 text-white' : 'bg-black/5'}`}
              >
                {t(`driver.reschedule.slots.${s.key}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('driver.reschedule.noteLabel')} htmlFor="note">
          <Input id="note" placeholder={t('driver.reschedule.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button loading={busy} disabled={!when} className="flex w-full items-center justify-center gap-2" onClick={submit}>
        <CalendarCheck size={19} weight="fill" />
        {t('driver.reschedule.submit')}
      </Button>
    </div>
  );
}

export default function ReschedulePage() {
  return (
    <DriverShell nav={false}>
      <Reschedule />
    </DriverShell>
  );
}
