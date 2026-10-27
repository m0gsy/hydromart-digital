import type { ExportLogEntry, ScheduledReport } from '@/lib/types';

/**
 * The slug admin-service puts in front of every file a schedule produces
 * (`reportFileName` in report-window's sibling, report-file.ts). Export logs carry no
 * schedule id, so the file name is the only link between a run and its schedule.
 */
export function reportSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'laporan'
  );
}

/** Newest finished file this schedule produced, out of a newest-first export-log page. */
export function filesFor(report: ScheduledReport, logs: ExportLogEntry[]): ExportLogEntry[] {
  const prefix = `${reportSlug(report.name)}-`;
  return logs.filter(
    (l) =>
      l.status === 'DONE' &&
      l.hasFile &&
      l.dataset === report.dataset &&
      l.fileName?.startsWith(prefix) &&
      // `slug-YYYY-MM-DD.ext`: a schedule named "pendapatan" must not claim the files of
      // "pendapatan-harian".
      /^\d{4}-\d{2}-\d{2}\./.test(l.fileName.slice(prefix.length)),
  );
}

/** Whole days/hours/minutes until `iso`, for "in 5 hours"; null when it is already past. */
export function untilParts(
  iso: string,
  now = Date.now(),
): { unit: 'day' | 'hour' | 'minute'; value: number } | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 24 * 60) return { unit: 'day', value: Math.round(minutes / (24 * 60)) };
  if (minutes >= 60) return { unit: 'hour', value: Math.round(minutes / 60) };
  return { unit: 'minute', value: Math.max(1, minutes) };
}
