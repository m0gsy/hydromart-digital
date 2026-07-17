'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, CalendarCheck } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';

const SLOTS = ['Pagi (09:00–12:00)', 'Siang (12:00–15:00)', 'Sore (15:00–18:00)'];

function Reschedule() {
  const router = useRouter();
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
      setError(e instanceof ApiError ? e.message : 'Gagal menjadwalkan ulang. Coba lagi.');
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
        <div className="text-sm font-extrabold">Jadwal ulang pengantaran</div>
      </header>

      <Card className="space-y-4 p-4">
        <Field label="Waktu antar baru" htmlFor="when">
          <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Slot (opsional)">
          <div className="flex flex-wrap gap-2">
            {SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s === slot ? '' : s)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${s === slot ? 'bg-brand-600 text-white' : 'bg-black/5'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Catatan (opsional)" htmlFor="note">
          <Input id="note" placeholder="Mis. pelanggan minta diantar besok" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button loading={busy} disabled={!when} className="flex w-full items-center justify-center gap-2" onClick={submit}>
        <CalendarCheck size={19} weight="fill" />
        Simpan jadwal ulang
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
