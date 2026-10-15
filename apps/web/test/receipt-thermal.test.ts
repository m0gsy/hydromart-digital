// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetPrinter,
  getSavedPrinter,
  printThermal,
  requestPrinterPermissions,
  row,
  savePrinter,
  scanPrinters,
  thermalErrorKey,
  toAscii,
  toPrintItems,
  wrap,
} from '@/lib/receipt-thermal';
import { buildReceiptModel } from '@/lib/receipt';
import type { Order } from '@/lib/types';

const ORDER = {
  id: 'o-1',
  orderNumber: 'HM-260825-001',
  status: 'COMPLETED',
  createdAt: '2026-08-25T10:00:00.000Z',
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
  items: [
    { productName: 'Galon 19L', quantity: 2, unitPrice: 20000, lineTotal: 40000 },
    {
      productName: 'Air Mineral Premium Kemasan Botol Besar Sangat Panjang Sekali',
      quantity: 1,
      unitPrice: 5000,
      lineTotal: 5000,
    },
  ],
  subtotal: 45000,
  deliveryFee: 0,
  discount: 5000,
  total: 40000,
} as unknown as Order;

const t = (k: string) => k.split('.').pop() ?? k;

const lines = (cols: number, outlet = {}) =>
  toPrintItems(
    buildReceiptModel(ORDER, t, { cashReceived: 50000, change: 10000 }, 'CASH', outlet),
    cols,
  ).map((i) => i.value);

describe('toAscii', () => {
  it('turns the symbols the receipt uses into ASCII a roll printer agrees on', () => {
    expect(toAscii('2 × Rp 20.000 · −Rp 5.000 — ok')).toBe('2 x Rp 20.000 - -Rp 5.000 - ok');
    expect(toAscii('a b')).toBe('a b');
  });

  it('strips diacritics and replaces what has no ASCII form', () => {
    expect(toAscii('Café Résumé')).toBe('Cafe Resume');
    expect(toAscii('日本')).toBe('??');
  });

  it('maps typographic quotes and ellipsis', () => {
    expect(toAscii('‘a’ “b” …')).toBe('\'a\' "b" ...');
  });
});

describe('wrap', () => {
  it('breaks on spaces within the width', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
  });

  it('splits a word longer than a whole line', () => {
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrap('xx abcdefghij', 4)).toEqual(['xx', 'abcd', 'efgh', 'ij']);
  });

  it('answers one empty line for empty text, never none', () => {
    expect(wrap('', 10)).toEqual(['']);
  });
});

describe('row', () => {
  it('puts the value flush right on one line when it fits', () => {
    expect(row('Total', 'Rp 40.000', 20)).toEqual(['Total      Rp 40.000']);
    expect(row('Total', 'Rp 40.000', 20)[0]).toHaveLength(20);
  });

  it('wraps the label and keeps the value on its last line', () => {
    const out = row('Galon besar sekali', 'Rp 1', 12);
    expect(out.length).toBeGreaterThan(1);
    expect(out[out.length - 1]!.endsWith('Rp 1')).toBe(true);
    expect(out.every((l) => l.length <= 12)).toBe(true);
  });

  it('gives a value too wide to share a line one of its own', () => {
    expect(row('Total', 'Rp 1.000.000.000', 16)).toEqual(['Total', 'Rp 1.000.000.000']);
  });
});

describe('toPrintItems', () => {
  it.each([32, 48])('never exceeds %i columns', (cols) => {
    for (const l of lines(cols, {
      depotName: 'Depot Cibubur Raya Sentosa Makmur',
      depotCity: 'Bandung',
      depotPhone: '0812-3456-7890',
      cashierName: 'Rina',
      shiftId: 'a1b2c3d4-e5f6-4a5b-8c9d-000000000000',
    })) {
      // The title is printed at double width, so it occupies twice its length.
      if (l === 'HYDROMART') continue;
      expect(l.length).toBeLessThanOrEqual(cols);
    }
  });

  it('carries the totals, tender and the depot phone', () => {
    const out = lines(32, { depotName: 'Depot Cibubur', depotPhone: '0812-3456-7890' });
    const joined = out.join('\n');
    expect(joined).toContain('Depot Cibubur');
    expect(joined).toContain('phone: 0812-3456-7890');
    expect(joined).toMatch(/total\s+Rp 40\.000/);
    expect(joined).toMatch(/cash\s+Rp 50\.000/);
    expect(joined).toMatch(/change\s+Rp 10\.000/);
    expect(joined).toMatch(/discount\s+-Rp 5\.000/);
  });

  it('is plain ASCII throughout', () => {
    for (const l of lines(32)) expect(l).toMatch(/^[\x20-\x7e]*$/);
  });

  it('prints no phone line when the depot has none', () => {
    expect(lines(32, { depotName: 'Depot Cibubur', depotPhone: null }).join('\n')).not.toContain(
      'phone',
    );
  });

  it('bolds the total and nothing else in the totals block', () => {
    const items = toPrintItems(buildReceiptModel(ORDER, t), 32);
    const bold = items.filter((i) => i.style?.bold && i.value !== 'HYDROMART');
    expect(bold).toHaveLength(1);
    expect(bold[0]!.value).toMatch(/^total\s+Rp 40\.000$/);
  });
});

describe('thermalErrorKey', () => {
  it.each([
    ['BLUETOOTH_DISABLED', 'bluetoothOff'],
    ['PAIRING_REQUIRED', 'pairing'],
    ['PERMISSION_DENIED', 'permission'],
    ['PAPER_EMPTY', 'paperEmpty'],
    ['COVER_OPEN', 'coverOpen'],
    ['PRINTER_OFFLINE', 'unreachable'],
    ['PRINTER_NOT_FOUND', 'unreachable'],
    ['CONNECTION_FAILED', 'unreachable'],
    ['WIFI_NOT_CONNECTED', 'unreachable'],
    ['TIMEOUT', 'unreachable'],
    ['UNKNOWN', 'generic'],
    ['', 'generic'],
  ])('%s -> %s', (code, key) => {
    expect(thermalErrorKey(code)).toBe(`hrFix.printer.err.${key}`);
  });
});

type Fn = ReturnType<typeof vi.fn>;
const plugin: Record<string, Fn> = {};

function install(methods: Record<string, (o?: unknown) => unknown> | null) {
  for (const k of Object.keys(plugin)) delete plugin[k];
  if (methods) {
    for (const [k, v] of Object.entries(methods)) plugin[k] = vi.fn(async (o?: unknown) => v(o));
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: { ThermalPrinter: plugin },
    };
  } else {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  }
}

beforeEach(() => install(null));
afterEach(() => vi.clearAllMocks());

describe('printThermal', () => {
  const items = [{ type: 'text' as const, value: 'x' }];

  it('says no-printer when the plugin is absent', async () => {
    expect(await printThermal(items, 58)).toEqual({ kind: 'no-printer' });
  });

  it('says no-printer when nothing was ever saved', async () => {
    install({ getDefaultPrinter: () => ({ profile: null }) });
    expect(await printThermal(items, 58)).toEqual({ kind: 'no-printer' });
    expect(plugin.printText).toBeUndefined();
  });

  it('prints to the saved printer with the roll width and a cut', async () => {
    install({ getDefaultPrinter: () => ({ profile: { id: 'bt:1' } }), printText: () => ({}) });
    expect(await printThermal(items, 80)).toEqual({ kind: 'printed' });
    expect(plugin.printText).toHaveBeenCalledWith(
      expect.objectContaining({ items, paperWidthMm: 80, cut: true, encoding: 'WPC1252' }),
    );
  });

  it('carries the plugin error code when printing is refused', async () => {
    install({
      getDefaultPrinter: () => ({ profile: { id: 'bt:1' } }),
      printText: () => {
        throw Object.assign(new Error('x'), { code: 'PAPER_EMPTY' });
      },
    });
    expect(await printThermal(items, 58)).toEqual({ kind: 'failed', code: 'PAPER_EMPTY' });
  });
});

describe('printer setup calls', () => {
  it('treats only an explicit denial as denied', async () => {
    install({
      requestPermissions: () => ({ bluetoothScan: 'denied', bluetoothConnect: 'granted' }),
    });
    expect(await requestPrinterPermissions()).toBe(false);
    install({
      requestPermissions: () => ({ bluetoothScan: 'granted', bluetoothConnect: 'granted' }),
    });
    expect(await requestPrinterPermissions()).toBe(true);
    install(null);
    expect(await requestPrinterPermissions()).toBe(true);
  });

  it('lists each printer once and names an unnamed one by its id', async () => {
    install({
      discoverPrinters: () => ({
        printers: [
          { id: 'a', name: 'RPP02', transport: 'bluetooth' },
          { id: 'a', name: 'RPP02', transport: 'bluetooth' },
          { id: 'b', transport: 'wifi' },
          { name: 'no id' },
        ],
      }),
    });
    const res = await scanPrinters();
    expect(res).toEqual({
      ok: true,
      value: [
        { id: 'a', name: 'RPP02', transport: 'bluetooth' },
        { id: 'b', name: 'b', transport: 'wifi' },
      ],
    });
  });

  it('reports a scan failure by code, and an empty reply as no printers', async () => {
    install({
      discoverPrinters: () => {
        throw Object.assign(new Error('x'), { code: 'BLUETOOTH_DISABLED' });
      },
    });
    expect(await scanPrinters()).toEqual({ ok: false, code: 'BLUETOOTH_DISABLED' });
    install({ discoverPrinters: () => ({}) });
    expect(await scanPrinters()).toEqual({ ok: true, value: [] });
  });

  it('saves as default and reports the printer-reported paper width', async () => {
    install({ connectPrinter: () => ({ connected: true, paper: { widthMm: 58 } }) });
    expect(await savePrinter('bt:1')).toEqual({ ok: true, value: { widthMm: 58 } });
    expect(plugin.connectPrinter).toHaveBeenCalledWith({ printerId: 'bt:1', setAsDefault: true });
  });

  it('does not call an unconnected printer saved', async () => {
    install({ connectPrinter: () => ({ connected: false }) });
    expect(await savePrinter('bt:1')).toEqual({ ok: false, code: 'CONNECTION_FAILED' });
    install({ connectPrinter: () => ({ connected: true }) });
    expect(await savePrinter('bt:1')).toEqual({ ok: true, value: { widthMm: null } });
    install({
      connectPrinter: () => {
        throw Object.assign(new Error('x'), { code: 'PAIRING_REQUIRED' });
      },
    });
    expect(await savePrinter('bt:1')).toEqual({ ok: false, code: 'PAIRING_REQUIRED' });
  });

  it('reads and forgets the saved printer', async () => {
    install({
      getDefaultPrinter: () => ({ profile: { id: 'bt:1', name: 'RPP02' } }),
      removePrinter: () => undefined,
    });
    expect(await getSavedPrinter()).toEqual({ id: 'bt:1', name: 'RPP02' });
    expect(await forgetPrinter('bt:1')).toBe(true);
    install({ getDefaultPrinter: () => ({ profile: { id: 'bt:2' } }) });
    expect(await getSavedPrinter()).toEqual({ id: 'bt:2', name: 'bt:2' });
    install({ getDefaultPrinter: () => ({ profile: null }) });
    expect(await getSavedPrinter()).toBeNull();
    install(null);
    expect(await forgetPrinter('x')).toBe(false);
  });
});
