import { describe, expect, it } from 'vitest';

import { filesFor, reportSlug, untilParts } from '@/lib/hq/scheduled-report';
import type { ExportLogEntry, ScheduledReport } from '@/lib/types';

const sched = { name: 'Pendapatan per depot', dataset: 'REVENUE_BY_DEPOT' } as ScheduledReport;
const log = (over: Partial<ExportLogEntry>): ExportLogEntry =>
  ({
    id: 'x',
    dataset: 'REVENUE_BY_DEPOT',
    status: 'DONE',
    hasFile: true,
    fileName: 'pendapatan-per-depot-2026-10-25.xlsx',
    ...over,
  }) as ExportLogEntry;

describe('scheduled report helpers', () => {
  it('slugs like the server', () => {
    expect(reportSlug('Pendapatan per depot!')).toBe('pendapatan-per-depot');
    expect(reportSlug('###')).toBe('laporan');
  });

  it("matches only this schedule's finished files", () => {
    const mine = log({ id: 'a' });
    const rows = [
      mine,
      log({ id: 'b', status: 'FAILED' }),
      log({ id: 'c', dataset: 'REVENUE_BY_METHOD' }),
      log({ id: 'd', fileName: 'pendapatan-per-depot-harian-2026-10-25.xlsx' }),
      log({ id: 'e', hasFile: false }),
    ];
    expect(filesFor(sched, rows)).toEqual([mine]);
  });

  it('counts down in the largest whole unit', () => {
    const now = Date.parse('2026-10-26T00:00:00Z');
    expect(untilParts('2026-10-26T05:00:00Z', now)).toEqual({ unit: 'hour', value: 5 });
    expect(untilParts('2026-10-26T00:20:00Z', now)).toEqual({ unit: 'minute', value: 20 });
    expect(untilParts('2026-10-28T00:00:00Z', now)).toEqual({ unit: 'day', value: 2 });
    expect(untilParts('2026-10-25T00:00:00Z', now)).toBeNull();
  });
});
