'use client';

import { useEffect, useState } from 'react';

import { Sheet } from '@/components/overlay';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { isNativeShell } from '@/lib/platform';
import { COLUMNS, getPaperMm, setPaperMm, type PaperMm } from '@/lib/printer-prefs';
import {
  forgetPrinter,
  getSavedPrinter,
  printThermal,
  requestPrinterPermissions,
  savePrinter,
  scanPrinters,
  thermalErrorKey,
  toAscii,
  type PrintItem,
  type ScannedPrinter,
} from '@/lib/receipt-thermal';

const PAPERS: PaperMm[] = [58, 80];

/**
 * Where a cashier connects the till's thermal printer.
 *
 * On the Android app it scans, saves the chosen printer as the default and prints a test
 * line. In a browser there is nothing to connect — the OS print dialog owns the printer —
 * so it only records the paper width, which is what makes the browser print fit the roll.
 */
export function PrinterSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const native = open && isNativeShell();
  const [paper, setPaper] = useState<PaperMm | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [found, setFound] = useState<ScannedPrinter[] | null>(null);
  const [busy, setBusy] = useState<'scan' | 'save' | 'test' | null>(null);

  useEffect(() => {
    if (!open) return;
    setPaper(getPaperMm());
    setFound(null);
    if (isNativeShell()) void getSavedPrinter().then(setSaved);
  }, [open]);

  function say(code: string) {
    toast(t(thermalErrorKey(code)), 'error');
  }

  async function scan() {
    setBusy('scan');
    try {
      if (!(await requestPrinterPermissions())) return say('PERMISSION_DENIED');
      const res = await scanPrinters();
      if (!res.ok) return say(res.code);
      setFound(res.value);
    } finally {
      setBusy(null);
    }
  }

  async function use(printer: ScannedPrinter) {
    setBusy('save');
    try {
      const res = await savePrinter(printer.id);
      if (!res.ok) return say(res.code);
      setSaved({ id: printer.id, name: printer.name });
      // The printer's own word on its paper wins over a guess; the cashier's earlier
      // choice is kept when it does not say.
      if (res.value.widthMm === 58 || res.value.widthMm === 80) {
        setPaperMm(res.value.widthMm);
        setPaper(res.value.widthMm);
      }
      toast(t('hrFix.printer.saved'), 'success');
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    const roll = paper ?? 58;
    const dash = '-'.repeat(COLUMNS[roll]);
    const line = (value: string, bold = false): PrintItem => ({
      type: 'text',
      value: toAscii(value),
      style: bold ? { align: 'center', bold: true } : { align: 'center' },
    });
    setBusy('test');
    try {
      const out = await printThermal(
        [
          line('HYDROMART', true),
          line(dash),
          line(t('hrFix.printer.testLine')),
          line(`${roll} mm / ${COLUMNS[roll]}`),
          line(dash),
        ],
        roll,
      );
      if (out.kind === 'printed') toast(t('hrFix.printer.testOk'), 'success');
      else if (out.kind === 'failed') say(out.code);
      else toast(t('hrFix.printer.noneSaved'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function forget() {
    if (!saved) return;
    if (await forgetPrinter(saved.id)) {
      setSaved(null);
      toast(t('hrFix.printer.forgotten'), 'success');
    }
  }

  function choose(mm: PaperMm) {
    setPaperMm(mm);
    setPaper(mm);
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('hrFix.printer.title')}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          {native ? t('hrFix.printer.intro') : t('hrFix.printer.webIntro')}
        </p>

        <div>
          <p className="mb-2 text-sm font-semibold">{t('hrFix.printer.paper')}</p>
          <div className="flex gap-2" role="radiogroup" aria-label={t('hrFix.printer.paper')}>
            {PAPERS.map((mm) => (
              <Button
                key={mm}
                variant={paper === mm ? 'primary' : 'secondary'}
                role="radio"
                aria-checked={paper === mm}
                onClick={() => choose(mm)}
              >
                {mm} mm
              </Button>
            ))}
          </div>
          {paper === null && (
            <p className="mt-1 text-xs text-muted">{t('hrFix.printer.paperUnknown')}</p>
          )}
        </div>

        {native && (
          <>
            <div className="rounded-lg border border-app p-3 text-sm">
              <p className="text-xs text-muted">{t('hrFix.printer.current')}</p>
              <p className="font-semibold">{saved ? saved.name : t('hrFix.printer.noneSaved')}</p>
              {saved && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void test()} loading={busy === 'test'}>
                    {t('hrFix.printer.test')}
                  </Button>
                  <Button variant="ghost" onClick={() => void forget()}>
                    {t('hrFix.printer.forget')}
                  </Button>
                </div>
              )}
            </div>

            <div>
              <Button onClick={() => void scan()} loading={busy === 'scan'}>
                {busy === 'scan' ? t('hrFix.printer.scanning') : t('hrFix.printer.scan')}
              </Button>
              {found && found.length === 0 && (
                <p className="mt-2 text-sm text-muted">{t('hrFix.printer.none')}</p>
              )}
              {found && found.length > 0 && (
                <ul className="mt-3 divide-y divide-[color:var(--border)] rounded-lg border border-app">
                  {found.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{p.name}</p>
                        <p className="text-xs text-muted">{p.transport}</p>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => void use(p)}
                        loading={busy === 'save'}
                      >
                        {t('hrFix.printer.use')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
