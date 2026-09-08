'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { FaceCapture } from '@/components/hr/face-capture';
import { OfflineQueueBanner } from '@/components/offline-queue-banner';
import { useToast } from '@/components/toast';
import { Button, Card, SectionHeader } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { currentPosition, geoReason } from '@/lib/geo';
import {
  ATTENDANCE_STATUS_LABEL,
  fmtTime,
  type Attendance,
  type AttendanceStatus,
} from '@/lib/hr';
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
  // Through the shared `currentPosition`: it falls back to the coarse provider, which is the
  // only one an employee who granted "Perkiraan" (Android 12+) has. A precise-only request
  // on that phone times out and the employee is told to grant an already-granted permission
  // — a check-in they cannot complete because of a message that is not true.
  return currentPosition().then(
    (pos) => ({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    (err: unknown) => {
      const reason = geoReason(err);
      throw new Error(reason === 'unsupported' ? messages.noGps : messages.allowGps);
    },
  );
}

/** CA-1-74: LATE and PENDING are not successes, and were painted as one. */
const RESULT_TONE: Partial<Record<AttendanceStatus, string>> = {
  PRESENT: 'text-green-700',
  LATE: 'text-[color:var(--warning)]',
  PENDING: 'text-[color:var(--warning)]',
  ABSENT: 'text-[color:var(--danger)]',
};

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
      toast(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('hrFix.checkIn.failed'),
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-6">
      <SectionHeader title={t('hrFix.checkIn.title')} />

      <OfflineQueueBanner />

      {/*
        * CA-1-77 — which of these is selected was said in colour alone. A screen reader
        * announced two identical buttons, so an employee using one could not tell whether
        * they were about to punch IN or OUT — on the screen that files the record their
        * pay is computed from. `aria-pressed` is what makes a toggle a toggle.
        */}
      <div className="flex gap-2" role="group" aria-label={t('hrFix.checkIn.title')}>
        <Button
          variant={mode === 'in' ? 'primary' : 'secondary'}
          className="flex-1"
          aria-pressed={mode === 'in'}
          onClick={() => setMode('in')}
        >
          {t('hrFix.checkIn.checkIn')}
        </Button>
        <Button
          variant={mode === 'out' ? 'primary' : 'secondary'}
          className="flex-1"
          aria-pressed={mode === 'out'}
          onClick={() => setMode('out')}
        >
          {t('hrFix.checkIn.checkOut')}
        </Button>
      </div>

      <Card className="p-5">
        <FaceCapture onCapture={punch} disabled={busy} />
      </Card>

      {result && (
        <Card className="p-4 text-center">
          {/*
            * CA-1-74 — the answer to "did my punch count", in words and in the right colour.
            *
            * It printed `result.status` raw, so an employee standing at the door read
            * "PENDING" or "LATE" — database values, in English — and it printed them GREEN
            * whatever they said. PENDING is the one that matters: an offline punch whose
            * device clock could not be trusted counts as nothing until HR decides, and it
            * looked exactly like a successful check-in.
            */}
          <p className={`font-bold ${RESULT_TONE[result.status] ?? 'text-green-700'}`}>
            {t(ATTENDANCE_STATUS_LABEL[result.status])}
          </p>
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
