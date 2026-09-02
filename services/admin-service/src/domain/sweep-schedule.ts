/**
 * The scheduled sweeps that are supposed to be running (CA-5-01).
 *
 * This list — not the `sweep_runs` table — is what the console renders. That is the whole
 * point. A table can only show a job that has REPORTED, and the jobs that have never
 * reported at all are exactly the ones the old marker files hid: on the box where this was
 * written, `subscriptions/process-due` and `webhooks/deliveries/process` had no marker file
 * of either kind, meaning they had not run once, and nothing anywhere said so.
 *
 * Kept in sync with `scripts/scheduler/crontab` by `scripts/check-sweep-observer.mjs`, which
 * fails CI if a scheduled sweep is missing here or if a job here is no longer scheduled. A
 * job listed but not scheduled would read as permanently overdue, which trains people to
 * ignore the screen — the same blindness, wearing a red badge.
 */
export interface ScheduledSweep {
  /** The path exactly as the crontab passes it to sweep.sh. */
  job: string;
  /** Cadence in minutes, from the crontab expression. Drives the overdue verdict. */
  everyMinutes: number;
  /** Short Indonesian label for the console. */
  label: string;
  /**
   * Set when the sweep is deliberately doing nothing, with the reason.
   *
   * Owner decision D9 (2 September 2026): point expiry stays OFF. The sweep runs nightly
   * and expires nothing until `pointExpirySweepEnabled` is set. Without this flag the
   * screen would report a healthy round every night for a feature that is switched off,
   * or — worse — somebody would "fix" the quiet row by flipping the switch, which writes
   * permanently to every customer's points balance.
   */
  dormant?: string;
}

export const SWEEP_SCHEDULE: ScheduledSweep[] = [
  { job: 'subscriptions/process-due', everyMinutes: 60, label: 'Langganan jatuh tempo' },
  { job: 'orders/reminders/reorder', everyMinutes: 1440, label: 'Pengingat pesan ulang' },
  { job: 'orders/outbox/internal/process', everyMinutes: 10, label: 'Efek pesanan tertunda' },
  { job: 'payments/internal/expire-pending', everyMinutes: 60, label: 'Pembayaran kedaluwarsa' },
  { job: 'orders/internal/expire-abandoned', everyMinutes: 60, label: 'Pesanan terbengkalai' },
  { job: 'deliveries/internal/sla-sweep', everyMinutes: 10, label: 'Pengantaran lewat SLA' },
  {
    job: 'customers/internal/resellers/apply-scheduled',
    everyMinutes: 60,
    label: 'Tarif reseller terjadwal',
  },
  { job: 'retention/internal/purge', everyMinutes: 1440, label: 'Penghapusan data UU PDP' },
  { job: 'announcements/publish-due', everyMinutes: 15, label: 'Pengumuman terbit' },
  { job: 'campaigns/internal/process-sending', everyMinutes: 2, label: 'Kampanye terkirim' },
  { job: 'webhooks/deliveries/process', everyMinutes: 5, label: 'Webhook mitra' },
  {
    job: 'reports/internal/daily-sales-broadcast/siang',
    everyMinutes: 1440,
    label: 'Laporan penjualan siang',
  },
  {
    job: 'reports/internal/daily-sales-broadcast/sore',
    everyMinutes: 1440,
    label: 'Laporan penjualan sore',
  },
  { job: 'scheduled-reports/internal/run-due', everyMinutes: 60, label: 'Laporan terjadwal' },
  { job: 'fraud-flags/internal/scan', everyMinutes: 1440, label: 'Pemindaian kecurangan' },
  { job: 'profile/internal/birthday-rewards', everyMinutes: 1440, label: 'Hadiah ulang tahun' },
  {
    job: 'loyalty/internal/expire',
    everyMinutes: 1440,
    label: 'Kedaluwarsa poin',
    dormant:
      'Sengaja dimatikan (keputusan pemilik 2 September 2026). Sapuan berjalan tiap malam ' +
      'dan tidak menghanguskan apa pun sampai pointExpirySweepEnabled disetel.',
  },
];

/** How a sweep is doing, once its last run is put beside its schedule. */
export type SweepVerdict = 'OK' | 'FAILING' | 'OVERDUE' | 'NEVER_RAN' | 'DORMANT';

/**
 * A sweep is late once it has missed its cadence with room to spare.
 *
 * Twice the interval plus five minutes, so a job that merely started a little late — a slow
 * round, a container restart, a tick that overlapped its own lock — does not raise an alarm
 * that people then learn to ignore. Two consecutive misses is a real stoppage.
 */
export function overdueAfterMinutes(everyMinutes: number): number {
  return everyMinutes * 2 + 5;
}

export function verdictFor(
  sweep: ScheduledSweep,
  run: { lastRunAt: Date; ok: boolean } | null,
  now: Date,
): SweepVerdict {
  // Dormancy is reported ahead of everything else on purpose. A switched-off sweep that is
  // quiet is not a fault, and showing it as one is how a deliberate decision gets "fixed".
  if (sweep.dormant) return 'DORMANT';
  if (!run) return 'NEVER_RAN';
  const ageMinutes = (now.getTime() - run.lastRunAt.getTime()) / 60_000;
  if (ageMinutes > overdueAfterMinutes(sweep.everyMinutes)) return 'OVERDUE';
  // Ran recently but reported a dead round. `ok` is the service's own verdict, not HTTP 200.
  return run.ok ? 'OK' : 'FAILING';
}
