'use client';

import { useState } from 'react';

import { FaceCapture } from '@/components/hr/face-capture';
import { useToast } from '@/components/toast';
import { Button, Card, SectionHeader } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';

export default function MeEnrollPage() {
  const { toast } = useToast();
  const [frames, setFrames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(endpoints.hr.enrollFaceMe, { images: frames }, true);
      toast('Wajah berhasil didaftarkan');
      setDone(true);
      setFrames([]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal enroll', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <SectionHeader title="Daftar Wajah" subtitle="Ambil 1–3 foto wajah yang jelas untuk absensi" />
      <Card className="space-y-3 p-5">
        <FaceCapture onCapture={(f) => setFrames((p) => [...p, f].slice(0, 3))} disabled={frames.length >= 3} />
        {frames.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm">{frames.length} foto siap</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setFrames([])}>Reset</Button>
              <Button onClick={submit} loading={busy}>Simpan</Button>
            </div>
          </div>
        )}
      </Card>
      {done && <Card className="p-4 text-center text-green-700">Wajah terdaftar. Kamu bisa absen sekarang.</Card>}
    </div>
  );
}
