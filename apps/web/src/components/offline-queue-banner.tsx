'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/locale-context';
import { ArrowsClockwise, CloudSlash, Trash } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui';
import {
  discard,
  flush,
  flushNow,
  hydrate,
  pending,
  subscribe,
  type QueuedJob,
} from '@/lib/offline-queue';

// Keys, not copy: a bare object of Indonesian strings is one of the shapes the i18n
// scanner cannot read, and this banner is on every courier and HR screen.
const LABELS: Record<QueuedJob['kind'], string> = {
  hrPunch: 'courierFix.offlineQueue.hrPunch',
  shiftCheckIn: 'courierFix.offlineQueue.shiftCheckIn',
  pod: 'courierFix.offlineQueue.pod',
  // K2.9. `codConfirm` first on purpose when the queue is read aloud to a courier: it is
  // the only one of these where money has already changed hands.
  codConfirm: 'courierFix.offlineQueue.codConfirm',
  gallonReturn: 'courierFix.offlineQueue.gallonReturn',
  deliveryFail: 'courierFix.offlineQueue.deliveryFail',
  deliveryReschedule: 'courierFix.offlineQueue.deliveryReschedule',
};

/**
 * Shows what is still sitting on the device. Renders nothing when the queue is empty, so it
 * can be mounted unconditionally in the HR and driver layouts.
 */
export function OfflineQueueBanner() {
  const { t } = useT();
  const { confirm } = useConfirm();
  const [jobs, setJobs] = useState<QueuedJob[]>(pending());
  const [busy, setBusy] = useState(false);

  /*
   * CA-4-14 — the trash icon dropped a queued job on one tap, with no question, from a
   * banner that is on every courier and HR screen. What is queued here is the only copy:
   * a COD confirmation the courier has already taken cash for, a proof-of-delivery photo,
   * a clock-in. Discarding one does not retry anything and does not reach the server — the
   * money or the attendance simply never happened, and the courier finds out at cash-up.
   */
  const drop = async (job: QueuedJob) => {
    const ok = await confirm({
      title: t('hrFix.offlineBanner.discardTitle'),
      message: t('hrFix.offlineBanner.discardConfirm', { kind: t(LABELS[job.kind]) }),
      confirmLabel: t('hrFix.offlineBanner.discardConfirmLabel'),
    });
    if (ok) await discard(job.id);
  };

  useEffect(() => {
    const off = subscribe(setJobs);
    void hydrate().then(() => void flush());
    return off;
  }, []);

  if (jobs.length === 0) return null;

  const sendNow = async () => {
    setBusy(true);
    try {
      // `flushNow`, not `flush`: this is somebody pressing a button because they know the
      // gateway is back. Making them wait out a backoff window they cannot see is its own
      // kind of broken. The automatic flush on mount above still respects it.
      await flushNow();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-semibold">
        <CloudSlash size={16} weight="fill" />
        {t('hrFix.offlineBanner.pendingCount', { count: jobs.length })}
      </div>
      <ul className="space-y-1">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-start justify-between gap-2">
            <span>
              {t(LABELS[job.kind])} · {new Date(job.capturedAt).toLocaleString('id-ID')}
              {job.error && <span className="block text-xs text-red-700">{job.error}</span>}
            </span>
            <button
              type="button"
              aria-label={t('hrFix.offlineBanner.clearAria')}
              onClick={() => void drop(job)}
              className="shrink-0 text-amber-900/70 hover:text-red-700"
            >
              <Trash size={16} />
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={() => void sendNow()} disabled={busy}>
        <ArrowsClockwise size={16} className="mr-1" />
        {t('hrFix.offlineBanner.sendNow2')}
      </Button>
    </div>
  );
}
