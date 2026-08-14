'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';

import { useToast } from '@/components/toast';
import { Button, Card, Input, SectionHeader } from '@/components/ui';
import { getBlob } from '@/lib/api';
import { downloadBlob } from '@/lib/csv';
import { endpoints } from '@/lib/endpoints';
import { currentPeriod } from '@/lib/hr';

type Format = 'csv' | 'xlsx' | 'pdf';

const FORMATS: { key: Format; label: string }[] = [
  { key: 'csv', label: 'CSV' },
  { key: 'xlsx', label: 'Excel' },
  { key: 'pdf', label: 'PDF' },
];

/** Fetch an export (authenticated) and trigger a browser download. */
async function download(path: string, filename: string): Promise<void> {
  downloadBlob(filename, await getBlob(path));
}

export default function ReportsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');

  async function run(key: string, path: string, filename: string) {
    setBusy(key);
    try {
      await download(path, filename);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('hrFix.reports.downloadFailed'), 'error');
    } finally {
      setBusy('');
    }
  }

  /** Reports scoped by a date range. */
  function rangeReport(prefix: string, path: (f: Format) => string, base: string) {
    return (format: Format) => {
      if (!from || !to) {
        toast(t('hrFix.reports.fillRange'), 'error');
        return;
      }
      run(`${prefix}-${format}`, path(format), `${base}-${from}_${to}.${format}`);
    };
  }

  const rangeCards = [
    {
      key: 'att',
      label: t('hrFix.reports.attendance'),
      hint: t('hrFix.reports.attendanceBody'),
      base: 'attendance',
      path: (f: Format) => endpoints.hr.reportAttendance(from, to, undefined, f),
    },
    {
      key: 'late',
      label: t('hrFix.reports.lateness'),
      hint: t('hrFix.reports.latenessBody'),
      base: 'late',
      path: (f: Format) => endpoints.hr.hrReport('late', { from, to, format: f }),
    },
    {
      key: 'leave',
      label: t('hrFix.reports.leave'),
      hint: t('hrFix.reports.leaveBody'),
      base: 'leave',
      path: (f: Format) => endpoints.hr.hrReport('leave', { from, to, format: f }),
    },
    {
      key: 'ann',
      label: t('hrFix.reports.announcements'),
      hint: t('hrFix.reports.announcementsBody'),
      base: 'announcements',
      path: (f: Format) => endpoints.hr.hrReport('announcements', { from, to, format: f }),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title={t('hrFix.reports.title')} subtitle={t('hrFix.reports.subtitle')} />

      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Dari
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            Sampai
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm">
            Periode
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-muted">
          Rentang tanggal dipakai absensi, keterlambatan, cuti, dan pengumuman. Periode dipakai
          payroll dan kinerja. PDF memotong laporan panjang dan menyebutkannya di halaman.
        </p>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <p className="font-semibold">{t('hrFix.reports.directory')}</p>
          <p className="text-xs text-muted">{t('hrFix.reports.directoryBody')}</p>
        </div>
        <Formats
          busy={busy}
          prefix="emp"
          onPick={(f) =>
            run(`emp-${f}`, endpoints.hr.reportEmployees(undefined, f), `employees.${f}`)
          }
        />
      </Card>

      {rangeCards.map((c) => (
        <Card key={c.key} className="space-y-3 p-4">
          <div>
            <p className="font-semibold">{c.label}</p>
            <p className="text-xs text-muted">{c.hint}</p>
          </div>
          <Formats
            busy={busy}
            prefix={c.key}
            disabled={!from || !to}
            onPick={rangeReport(c.key, c.path, c.base)}
          />
        </Card>
      ))}

      <Card className="space-y-3 p-4">
        <div>
          <p className="font-semibold">{t('hrFix.reports.payroll')}</p>
          <p className="text-xs text-muted">{t('hrFix.reports.payrollBody')}</p>
        </div>
        <Formats
          busy={busy}
          prefix="pay"
          onPick={(f) =>
            run(
              `pay-${f}`,
              endpoints.hr.reportPayroll(period, undefined, f),
              `payroll-${period}.${f}`,
            )
          }
        />
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <p className="font-semibold">{t('hrFix.reports.performance')}</p>
          <p className="text-xs text-muted">
            Skor per periode. Komponen yang tidak terukur tampil kosong, bukan nol.
          </p>
        </div>
        <Formats
          busy={busy}
          prefix="perf"
          onPick={(f) =>
            run(
              `perf-${f}`,
              endpoints.hr.hrReport('performance', { periodMonth: period, format: f }),
              `performance-${period}.${f}`,
            )
          }
        />
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <p className="font-semibold">{t('hrFix.reports.assets')}</p>
          <p className="text-xs text-muted">{t('hrFix.reports.assetsBody')}</p>
        </div>
        <Formats
          busy={busy}
          prefix="asset"
          onPick={(f) =>
            run(`asset-${f}`, endpoints.hr.hrReport('assets', { format: f }), `assets.${f}`)
          }
        />
      </Card>
    </div>
  );
}

function Formats({
  busy,
  prefix,
  disabled,
  onPick,
}: {
  busy: string;
  prefix: string;
  disabled?: boolean;
  onPick: (format: Format) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {FORMATS.map((f) => (
        <Button
          key={f.key}
          variant="secondary"
          disabled={disabled}
          loading={busy === `${prefix}-${f.key}`}
          onClick={() => onPick(f.key)}
        >
          {f.label}
        </Button>
      ))}
    </div>
  );
}
