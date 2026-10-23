import { describe, expect, it } from 'vitest';

import type { ReceiptModel } from '@/lib/receipt';
import { receiptToText, whatsappUrl } from '@/lib/receipt-text';

const model: ReceiptModel = {
  docTitle: 'Struk WI-001',
  title: 'HYDROMART',
  outlet: ['Depot Dago · Bandung', 'Kasir: Rina'],
  subtitle: 'Struk · WI-001',
  stamp: '23 Okt 2026 10.00 · Selesai',
  contact: 'Budi · 0812',
  address: 'Ambil langsung di depot, -',
  items: [{ name: 'Air Galon 19L', detail: '2 × Rp 20.000', total: 'Rp 40.000' }],
  totals: [
    { label: 'Subtotal', value: 'Rp 40.000' },
    { label: 'Total', value: 'Rp 40.000', strong: true },
  ],
  thanks: 'Terima kasih',
};

describe('receiptToText', () => {
  it('says what the paper says: outlet, lines, totals, thanks', () => {
    const text = receiptToText(model);
    expect(text).toContain('HYDROMART');
    expect(text).toContain('Depot Dago · Bandung');
    expect(text).toContain('Air Galon 19L 2 × Rp 20.000 — Rp 40.000');
    expect(text).toContain('Total: Rp 40.000');
    expect(text.trimEnd().endsWith('Terima kasih')).toBe(true);
  });

  it('leaves the recipient and address out of a message sent to the buyer', () => {
    const text = receiptToText(model);
    expect(text).not.toContain('Budi · 0812');
    expect(text).not.toContain('Ambil langsung');
  });

  it('omits the thanks line when there is none', () => {
    expect(receiptToText({ ...model, thanks: '' }).trimEnd().endsWith('Rp 40.000')).toBe(true);
  });
});

describe('whatsappUrl', () => {
  const text = 'Struk & total: Rp 40.000';

  it.each([
    ['08123456789', '628123456789'],
    ['+62 812-3456-789', '628123456789'],
    ['628123456789', '628123456789'],
    ['8123456789', '628123456789'],
  ])('turns %s into %s', (input, intl) => {
    expect(whatsappUrl(input, text)).toBe(`https://wa.me/${intl}?text=${encodeURIComponent(text)}`);
  });

  it('encodes the message so & and newlines survive', () => {
    const url = whatsappUrl('08123456789', 'a&b\nc') as string;
    expect(url).toContain('a%26b%0Ac');
  });

  it.each(['', '-', '0812', '12345678901234567890', '+1 415 555 0100', 'abc'])(
    'refuses %j rather than send a receipt to a wrong number',
    (input) => {
      expect(whatsappUrl(input, text)).toBeNull();
    },
  );
});
