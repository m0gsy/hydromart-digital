import { normalizeMethod } from '../../src/application/ports/sales-import.repository';

describe('normalizeMethod', () => {
  it.each([
    ['Tunai', 'CASH'],
    ['tunai', 'CASH'],
    ['CASH', 'CASH'],
    ['Kontan', 'CASH'],
    ['Transfer Bank', 'TRANSFER'],
    ['transfer', 'TRANSFER'],
    ['Rekening BCA', 'TRANSFER'],
    ['QRIS', 'QRIS'],
    ['qris', 'QRIS'],
    ['E-Wallet', 'EWALLET'],
    ['OVO', 'EWALLET'],
    ['GoPay', 'EWALLET'],
    ['Virtual Account', 'VA'],
    ['va', 'VA'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeMethod(raw)).toBe(expected);
  });

  it('falls back to OTHER for unrecognised text, blank, or null', () => {
    expect(normalizeMethod('Kartu Kredit')).toBe('OTHER');
    expect(normalizeMethod('')).toBe('OTHER');
    expect(normalizeMethod(null)).toBe('OTHER');
  });
});
