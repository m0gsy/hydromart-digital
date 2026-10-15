import { askPlugin, tryPlugin } from './capacitor';
import type { ReceiptModel } from './receipt';

/**
 * The receipt as ESC/POS text lines for a thermal printer.
 *
 * Built from the same `ReceiptModel` the HTML template renders, so the paper and the
 * browser print cannot disagree about what a receipt says. Everything here except
 * `printThermal` is a pure function of the model and the column count.
 */

export type PrintItem = {
  type: 'text';
  value: string;
  style?: {
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    widthMultiplier?: number;
    heightMultiplier?: number;
  };
};

// By code point, not by literal: several of these look like ordinary characters (a
// non-breaking space is invisible) and an editor or a formatter will quietly "fix" them.
const REPLACEMENTS = new Map<number, string>([
  [0xd7, 'x'], // multiplication sign
  [0x2212, '-'], // minus sign
  [0x2013, '-'], // en dash
  [0x2014, '-'], // em dash
  [0xb7, '-'], // middle dot
  [0x2022, '-'], // bullet
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x2026, '...'], // ellipsis
  [0xa0, ' '], // non-breaking space
  [0x09, ' '],
  [0x0a, ' '],
  [0x0d, ' '],
]);

/**
 * Plain ASCII. A thermal printer is told the text is WPC1252 and most roll printers ship
 * with a different codepage selected, so anything above 0x7E prints as a different glyph
 * on a different model. ASCII is the one subset every one of them agrees on.
 */
export function toAscii(text: string): string {
  let out = '';
  // NFD splits "é" into "e" + a combining mark, so the accent can be dropped and the
  // letter kept.
  for (const ch of text.normalize('NFD')) {
    const code = ch.codePointAt(0) ?? 0;
    const mapped = REPLACEMENTS.get(code);
    if (mapped !== undefined) out += mapped;
    else if (code >= 0x300 && code <= 0x36f)
      continue; // combining marks
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else out += '?';
  }
  return out;
}

/** Break on spaces to `width`, and split a word that is longer than a whole line. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= width) current += ' ' + rest;
    else {
      lines.push(current);
      current = rest;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/** `left` flush left, `right` flush right, wrapping `left` when the two do not fit. */
export function row(left: string, right: string, cols: number): string[] {
  const room = cols - right.length - 1;
  if (room < 1) return [...wrap(left, cols), right.padStart(cols)];
  const lines = wrap(left, room);
  const last = lines.pop() ?? '';
  return [...lines, `${last.padEnd(room)} ${right}`];
}

export function toPrintItems(model: ReceiptModel, cols: number): PrintItem[] {
  const out: PrintItem[] = [];
  const text = (value: string, style?: PrintItem['style']) =>
    out.push({ type: 'text', value, ...(style ? { style } : {}) });
  const lines = (value: string, style?: PrintItem['style']) =>
    wrap(toAscii(value), cols).forEach((l) => text(l, style));
  const divider = () => text('-'.repeat(cols));

  text(toAscii(model.title), {
    align: 'center',
    bold: true,
    widthMultiplier: 2,
    heightMultiplier: 2,
  });
  model.outlet.forEach((l) => lines(l, { align: 'center' }));
  divider();
  lines(model.subtitle);
  lines(model.stamp);
  lines(model.contact);
  lines(model.address);
  divider();
  for (const item of model.items) {
    lines(item.name);
    row(`  ${toAscii(item.detail)}`, toAscii(item.total), cols).forEach((l) => text(l));
  }
  divider();
  for (const t of model.totals) {
    row(toAscii(t.label), toAscii(t.value), cols).forEach((l) =>
      text(l, t.strong ? { bold: true } : undefined),
    );
  }
  divider();
  lines(model.thanks, { align: 'center' });
  return out;
}

export type ThermalOutcome =
  { kind: 'printed' } | { kind: 'no-printer' } | { kind: 'failed'; code: string };

/**
 * Send the receipt to the saved default printer.
 *
 * `no-printer` is a normal answer, not a failure: nothing was ever set up, so the caller
 * does what it always did. `failed` carries the plugin's own error code — the screen maps
 * it to a sentence, this file does not know what language the cashier reads.
 */
export async function printThermal(
  items: PrintItem[],
  paperWidthMm: number,
): Promise<ThermalOutcome> {
  const saved = await askPlugin<{ profile?: { id?: string } | null }>(
    'ThermalPrinter',
    'getDefaultPrinter',
  );
  if (!saved?.profile) return { kind: 'no-printer' };
  const result = await tryPlugin('ThermalPrinter', 'printText', {
    items,
    paperWidthMm,
    cut: true,
    feedLines: 3,
    encoding: 'WPC1252',
  });
  return result.ok ? { kind: 'printed' } : { kind: 'failed', code: result.code };
}

/**
 * Plugin error code -> the `hrFix.printer.err.*` key that says it in words. Several codes
 * share a sentence because the cashier's remedy is the same: the printer could not be
 * reached, and walking over to it is the next step regardless of which layer said so.
 */
export function thermalErrorKey(code: string): string {
  switch (code) {
    case 'BLUETOOTH_DISABLED':
      return 'hrFix.printer.err.bluetoothOff';
    case 'PAIRING_REQUIRED':
      return 'hrFix.printer.err.pairing';
    case 'PERMISSION_DENIED':
      return 'hrFix.printer.err.permission';
    case 'PAPER_EMPTY':
      return 'hrFix.printer.err.paperEmpty';
    case 'COVER_OPEN':
      return 'hrFix.printer.err.coverOpen';
    case 'PRINTER_OFFLINE':
    case 'PRINTER_NOT_FOUND':
    case 'CONNECTION_FAILED':
    case 'WIFI_NOT_CONNECTED':
    case 'TIMEOUT':
      return 'hrFix.printer.err.unreachable';
    default:
      return 'hrFix.printer.err.generic';
  }
}

export interface ScannedPrinter {
  id: string;
  name: string;
  transport: string;
}

export type SetupResult<T> = { ok: true; value: T } | { ok: false; code: string };

/** Ask for the Bluetooth permissions. `false` only when the user actually said no. */
export async function requestPrinterPermissions(): Promise<boolean> {
  const res = await askPlugin<{ bluetoothScan?: string; bluetoothConnect?: string }>(
    'ThermalPrinter',
    'requestPermissions',
  );
  // A missing plugin answers null: let the scan below report that, not a false "denied".
  if (!res) return true;
  return res.bluetoothScan !== 'denied' && res.bluetoothConnect !== 'denied';
}

export async function scanPrinters(timeoutMs = 8000): Promise<SetupResult<ScannedPrinter[]>> {
  const res = await tryPlugin<{
    printers?: { id: string; name?: string; transport?: string }[];
  }>('ThermalPrinter', 'discoverPrinters', { timeoutMs });
  if (!res.ok) return { ok: false, code: res.code };
  const seen = new Set<string>();
  const printers: ScannedPrinter[] = [];
  for (const p of res.value?.printers ?? []) {
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    printers.push({ id: p.id, name: p.name || p.id, transport: p.transport ?? '' });
  }
  return { ok: true, value: printers };
}

/**
 * Connect and remember. `setAsDefault` is applied by the plugin only when the connection
 * succeeds, so an unreachable printer is never persisted as the one to print to.
 */
export async function savePrinter(
  printerId: string,
): Promise<SetupResult<{ widthMm: number | null }>> {
  const res = await tryPlugin<{ connected?: boolean; paper?: { widthMm?: number | null } | null }>(
    'ThermalPrinter',
    'connectPrinter',
    { printerId, setAsDefault: true },
  );
  if (!res.ok) return { ok: false, code: res.code };
  if (!res.value?.connected) return { ok: false, code: 'CONNECTION_FAILED' };
  return { ok: true, value: { widthMm: res.value.paper?.widthMm ?? null } };
}

export async function getSavedPrinter(): Promise<{ id: string; name: string } | null> {
  const res = await askPlugin<{ profile?: { id?: string; name?: string } | null }>(
    'ThermalPrinter',
    'getDefaultPrinter',
  );
  const p = res?.profile;
  return p?.id ? { id: p.id, name: p.name || p.id } : null;
}

export async function forgetPrinter(printerId: string): Promise<boolean> {
  const res = await tryPlugin('ThermalPrinter', 'removePrinter', { printerId });
  return res.ok;
}
