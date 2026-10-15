// @vitest-environment jsdom
/*
 * K3.4 — the struk said "HYDROMART" and nothing else: not which depot, not which cashier,
 * not which shift. A customer coming back with a complaint held a piece of paper that named
 * no outlet, and a shift-close dispute had no way to tie a printed receipt to the till that
 * printed it. Those are the two questions the paper exists to answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const printed = vi.hoisted(() => ({
  html: '',
  thermal: undefined as { paperWidthMm: number } | undefined,
}));

vi.mock('@/lib/platform', () => ({
  printDocument: (html: string, thermal?: { paperWidthMm: number }) => {
    printed.html = html;
    printed.thermal = thermal;
    return true;
  },
}));

import { printReceipt } from '@/lib/receipt';
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
  items: [{ productName: 'Galon 19L', quantity: 2, unitPrice: 20000, lineTotal: 40000 }],
  subtotal: 40000,
  deliveryFee: 0,
  discount: 0,
  total: 40000,
} as unknown as Order;

const i18n = { t: (k: string) => k.split('.').pop() ?? k, locale: 'id' };

beforeEach(() => {
  printed.html = '';
});
afterEach(() => vi.clearAllMocks());

describe('K3.4 · the receipt names the till that printed it', () => {
  it('prints the depot, the cashier and the shift when the counter knows them', () => {
    printReceipt(ORDER, i18n, undefined, 'CASH', {
      depotName: 'Depot Cibubur',
      depotCity: 'Bandung',
      cashierName: 'Rina',
      shiftId: 'a1b2c3d4-e5f6-4a5b-8c9d-000000000000',
    });

    expect(printed.html).toContain('Depot Cibubur');
    expect(printed.html).toContain('Rina');
    // Shortened, because it is there to be matched against a shift close off thermal paper.
    expect(printed.html).toContain('a1b2c3d4');
    expect(printed.html).not.toContain('e5f6-4a5b');
  });

  /*
   * Two callers print this. The order-detail screen prints a delivered order, which has no
   * cashier and no shift — an empty "Kasir:" reads as a till that recorded nobody, which is
   * worse than no line at all.
   */
  it('omits a line the caller does not know rather than printing an empty label', () => {
    printReceipt(ORDER, i18n, undefined, undefined, { depotName: 'Depot Cibubur' });

    expect(printed.html).toContain('Depot Cibubur');
    expect(printed.html).not.toContain('cashier');
    expect(printed.html).not.toContain('shift');
  });

  it('prints exactly as before when the caller knows nothing about the outlet', () => {
    printReceipt(ORDER, i18n);

    expect(printed.html).toContain('HYDROMART');
    expect(printed.html).toContain('HM-260825-001');
    expect(printed.html).not.toContain('cashier');
  });

  /*
   * Non-PPN, decided. This is a commercial receipt, not a faktur pajak: no NPWP, no tax
   * row. A depot registered as PKP would need a different document with different legal
   * requirements, not an extra line on this one.
   */
  it('carries no tax identity, because this is not a faktur pajak', () => {
    printReceipt(ORDER, i18n, undefined, 'CASH', { depotName: 'Depot Cibubur' });

    expect(printed.html).not.toMatch(/NPWP|PPN|PKP/i);
  });

  it('escapes an outlet name rather than letting it into the markup', () => {
    printReceipt(ORDER, i18n, undefined, undefined, { depotName: '<script>x</script>' });

    expect(printed.html).not.toContain('<script>x</script>');
    expect(printed.html).toContain('&lt;script&gt;');
  });
  /*
   * The depot's own line, so a buyer holding the paper knows who to call about it. Same
   * rule as the cashier and shift lines: shown when known, absent when not — "Telp: -"
   * reads as a depot that has no phone, which is a claim the paper has no right to make.
   */
  it('prints the depot phone under the depot line when it is known', () => {
    printReceipt(ORDER, i18n, undefined, undefined, {
      depotName: 'Depot Cibubur',
      depotPhone: '0812-3456-7890',
    });

    expect(printed.html).toContain('phone: 0812-3456-7890');
    expect(printed.html.indexOf('Depot Cibubur')).toBeLessThan(
      printed.html.indexOf('0812-3456-7890'),
    );
  });

  it('prints no phone line, and no empty label, when the depot has none', () => {
    printReceipt(ORDER, i18n, undefined, undefined, {
      depotName: 'Depot Cibubur',
      depotPhone: null,
    });

    expect(printed.html).not.toContain('phone');
  });

  it('escapes a phone value rather than letting it into the markup', () => {
    printReceipt(ORDER, i18n, undefined, undefined, { depotPhone: '<b>1</b>' });

    expect(printed.html).not.toContain('<b>1</b>');
    expect(printed.html).toContain('&lt;b&gt;1&lt;/b&gt;');
  });

  /*
   * A 420px column on a 58 mm roll is what the till would have got without this — but an
   * office printer must keep printing A4, so the roll rules only apply once the cashier
   * has said what paper the printer takes.
   */
  it('sizes the page to the roll only after the cashier chose a width', () => {
    printReceipt(ORDER, i18n);
    expect(printed.html).not.toContain('@page');

    window.localStorage.setItem('hm.printer.paperMm', '80');
    printReceipt(ORDER, i18n);
    expect(printed.html).toContain('@page{size:80mm auto;margin:0}');
    window.localStorage.removeItem('hm.printer.paperMm');
  });

  it('prints at 58 mm columns when no width was ever chosen', () => {
    printReceipt(ORDER, i18n);
    expect(printed.thermal?.paperWidthMm).toBe(58);

    window.localStorage.setItem('hm.printer.paperMm', '80');
    printReceipt(ORDER, i18n);
    expect(printed.thermal?.paperWidthMm).toBe(80);
    window.localStorage.removeItem('hm.printer.paperMm');
  });
});
