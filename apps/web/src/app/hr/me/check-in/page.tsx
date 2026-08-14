'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { FaceCapture } from '@/components/hr/face-capture';
import { OfflineQueueBanner } from '@/components/offline-queue-banner';
import { useToast } from '@/components/toast';
import { Button, Card, SectionHeader } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fmtTime, type Attendance } from '@/lib/hr';
import { runOrQueue } from '@/lib/offline-queue';

type Mode = 'in' | 'out';

/**
 * Resolve the device GPS position (needed for the attendance geofence).
 *
 * Both refusal messages are passed in rather than translated here: this is a plain
 * function and a hook has no business in one — and both strings DO reach the employee,
 * so leaving them hardcoded was not an option either.
 */
function getPosition(messages: {
  noGps: string;
  allowGps: string;
}): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error(messages.noGps));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error(messages.allowGps)),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

export default function MeCheckInPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('in');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Attendance | null>(null);

  // `live` is the on-device capture gate: it keeps a blurred or still frame from being sent
  // at all. It is NOT sent to the server — a verdict the caller fills in themselves cannot
  // be an anti-spoofing control there (B-7); the face match is.
  async function punch(dataUrl: string, live: boolean) {
    if (!live) {
      toast(t('hrFix.checkIn.faceUnsure'), 'error');
      return;
    }
    setBusy(true);
    try {
      const { lat, lng } = await getPosition({
        noGps: t('hrFix.checkIn.noGps'),
        allowGps: t('hrFix.checkIn.allowGps'),
      });
      // Offline keeps the punch on the device with its capture time. A quick sync still
      // counts normally; one that sits here too long is held for HR to approve.
      const sent = await runOrQueue<Attendance>({
        kind: 'hrPunch',
        payload: { mode, image: dataUrl, lat, lng },
      });
      if (sent.outcome === 'queued') {
        setResult(null);
        toast(t('hrFix.checkIn.offlineQueued'));
        return;
      }
      setResult(sent.result);
      toast(mode === 'in' ? t('hrFix.checkIn.inOk') : t('hrFix.checkIn.outOk'));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t('hrFix.checkIn.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <SectionHeader title={t('hrFix.checkIn.title')} />

      <OfflineQueueBanner />

      <div className="flex gap-2">
        <Button variant={mode === 'in' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setMode('in')}>{t('hrFix.checkIn.checkIn')}</Button>
        <Button variant={mode === 'out' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setMode('out')}>{t('hrFix.checkIn.checkOut')}</Button>
      </div>

      <Card className="p-5">
        <FaceCapture onCapture={punch} disabled={busy} />
      </Card>

      {result && (
        <Card className="p-4 text-center">
          <p className="font-bold text-green-700">{result.status}</p>
          <p className="text-sm text-muted">
            {t('hrFix.checkIn.inAt', { at: fmtTime(result.checkInAt) })}
            {result.checkOutAt ? t('hrFix.checkIn.outAt', { at: fmtTime(result.checkOutAt) }) : ''}
            {result.lateMinutes > 0 ? t('hrFix.checkIn.lateBy', { n: result.lateMinutes }) : ''}
          </p>
        </Card>
      )}
    </div>
  );
}
