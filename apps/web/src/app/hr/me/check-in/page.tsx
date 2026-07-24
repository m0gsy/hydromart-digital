'use client';

import { useState } from 'react';

import { FaceCapture } from '@/components/hr/face-capture';
import { useToast } from '@/components/toast';
import { Button, Card, SectionHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { fmtTime, type Attendance } from '@/lib/hr';

type Mode = 'in' | 'out';

export default function MeCheckInPage() {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('in');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Attendance | null>(null);

  async function punch(dataUrl: string, live: boolean) {
    if (!live) {
      toast('Deteksi wajah kurang meyakinkan. Gerakkan kepala/kedip lalu coba lagi.', 'error');
      return;
    }
    setBusy(true);
    try {
      const path = mode === 'in' ? endpoints.hr.checkIn : endpoints.hr.checkOut;
      const row = await api.post<Attendance>(path, { image: dataUrl, live }, true);
      setResult(row);
      toast(mode === 'in' ? 'Check-in berhasil' : 'Check-out berhasil');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal absen', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <SectionHeader title="Absensi Wajah" />

      <div className="flex gap-2">
        <Button variant={mode === 'in' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setMode('in')}>Check-in</Button>
        <Button variant={mode === 'out' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setMode('out')}>Check-out</Button>
      </div>

      <Card className="p-5">
        <FaceCapture onCapture={punch} disabled={busy} />
      </Card>

      {result && (
        <Card className="p-4 text-center">
          <p className="font-bold text-green-700">{result.status}</p>
          <p className="text-sm text-muted">
            Masuk {fmtTime(result.checkInAt)}{result.checkOutAt ? ` · Keluar ${fmtTime(result.checkOutAt)}` : ''}
            {result.lateMinutes > 0 ? ` · Terlambat ${result.lateMinutes} menit` : ''}
          </p>
        </Card>
      )}
    </div>
  );
}
