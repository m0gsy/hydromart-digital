'use client';

import { useMemo, useRef, useState } from 'react';
import { UploadSimple } from '@phosphor-icons/react';

import { Button, Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

const IGNORE = '-1';

const COL_KEY = { phone: 'colPhone', name: 'colName', role: 'colRole', depot: 'colDepot' } as const;

// Minimal CSV split (comma-separated, trims quotes). Good enough for staff lists —
// no embedded-comma escaping (the import is a preview-then-commit, not a bulk pipeline).
// ponytail: naive split; swap for a real CSV parser only if files carry quoted commas.
function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
}

// Design 10c — bulk staff import. CSV parsed client-side; commit loops the real
// inviteStaff endpoint (phone + role + optional name). Depot column is display-only
// (inviteStaff carries no depot). Validation preview is real (derived from the parse).
export default function HqStaffImportPage() {
  const { t } = useT();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState({ phone: IGNORE, name: IGNORE, role: IGNORE, depot: IGNORE });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; fail: number } | null>(null);

  const columnCount = rows[0]?.length ?? 0;
  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);

  const valid = useMemo(() => {
    const p = Number(map.phone);
    const r = Number(map.role);
    if (p < 0 || r < 0) return { ready: [] as string[][], invalid: [] as string[][] };
    const ready: string[][] = [];
    const invalid: string[][] = [];
    for (const row of dataRows) {
      const phone = (row[p] ?? '').trim();
      const role = (row[r] ?? '').trim();
      if (phone && role) ready.push(row);
      else invalid.push(row);
    }
    return { ready, invalid };
  }, [dataRows, map.phone, map.role]);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setRows(parseCsv(String(reader.result ?? '')));
      setFileName(file.name);
      setResult(null);
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (rows.length === 0) return toast(t('hq.staffImport.noFile'), 'error');
    if (Number(map.phone) < 0 || Number(map.role) < 0) return toast(t('hq.staffImport.needMap'), 'error');
    setBusy(true);
    let ok = 0;
    let fail = 0;
    const p = Number(map.phone);
    const r = Number(map.role);
    const n = Number(map.name);
    for (const row of valid.ready) {
      try {
        await api.post(
          endpoints.auth.inviteStaff,
          { phone: (row[p] ?? '').trim(), role: (row[r] ?? '').trim(), fullName: n >= 0 ? (row[n] ?? '').trim() || undefined : undefined },
          true,
        );
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setResult({ ok, fail });
    setBusy(false);
    toast(t('hq.staffImport.result', { ok, fail }), fail === 0 ? 'success' : 'info');
  }

  const columnOptions = Array.from({ length: columnCount }, (_, i) => i);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <UploadSimple size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.staffImport.title')}</h1>
          <p className="text-sm text-muted">{t('hq.staffImport.subtitle')}</p>
        </div>
      </div>

      {/* Drop / pick */}
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted">{t('hq.staffImport.drop')}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          {t('hq.staffImport.browse')}
        </Button>
        {fileName && (
          <p className="text-xs text-muted">{t('hq.staffImport.file', { name: fileName, n: dataRows.length })}</p>
        )}
      </Card>

      {rows.length > 0 && (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            {t('hq.staffImport.hasHeader')}
          </label>

          {/* Column mapping */}
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-semibold">{t('hq.staffImport.mapping')}</h2>
            <p className="text-xs text-muted">{t('hq.staffImport.roleHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['phone', 'name', 'role', 'depot'] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t(`hq.staffImport.${COL_KEY[field]}`)}</span>
                  <select
                    value={map[field]}
                    onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}
                    className="surface-elevated rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
                  >
                    <option value={IGNORE}>{t('hq.staffImport.ignore')}</option>
                    {columnOptions.map((i) => (
                      <option key={i} value={i}>
                        {t('hq.staffImport.column', { n: i + 1 })}
                        {hasHeader && rows[0]?.[i] ? ` · ${rows[0][i]}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </Card>

          {/* Validation preview */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.staffImport.ready')}</p>
              <p className="text-2xl font-bold tabular-nums text-[color:var(--success)]">{valid.ready.length}</p>
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.staffImport.invalid')}</p>
              <p className="text-2xl font-bold tabular-nums text-red-600">{valid.invalid.length}</p>
            </Card>
          </div>

          {result && (
            <p className="text-sm font-semibold text-[color:var(--success)]">
              {t('hq.staffImport.result', { ok: result.ok, fail: result.fail })}
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={runImport} loading={busy} disabled={valid.ready.length === 0}>
              {busy ? t('hq.staffImport.importing') : t('hq.staffImport.import', { n: valid.ready.length })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
