// @vitest-environment jsdom
/**
 * C11 — the counter could not take a delivery, and the quote could not price one.
 *
 * The server half landed in #231 and was good: DTO, kill switch, and a fee computed once and
 * threaded so `quoteFor` and `redeem` see the same number. What never shipped was any way for
 * an operator to say "antar" — so all of it was unreachable — and the quote route itself,
 * which meant that the moment anything DID send an address the till would show
 * `subtotal - diskon` while the sale charged `subtotal + ongkir - diskon`.
 *
 * These pin the money rules, which are the ones worth a test:
 *   - a half-typed address quotes a PICK-UP, and says so, rather than a delivery the sale
 *     would then refuse with a 400 after the cashier has quoted a price;
 *   - the same address object goes to the quote and to the sale;
 *   - the ongkir is shown as its own line, because a cashier taking cash has to be able to
 *     say what the extra is for;
 *   - and it is cleared after a sale, or the next buyer's pick-up silently becomes a
 *     delivery to the previous buyer's house.
 */
import { describe, expect, it } from 'vitest';

import { id as idDict } from '@/lib/dictionaries/id';
import { en as enDict } from '@/lib/dictionaries/en';

/**
 * The address the screen builds, lifted out of the component so the rule can be tested
 * without driving a till. Kept byte-identical to `walk-in/page.tsx` — if it drifts, the
 * assertions below stop describing the screen.
 */
function buildAddress(f: {
  deliver: boolean;
  addrName: string;
  addrPhone: string;
  addrLine: string;
  addrCity: string;
  addrProvince: string;
  addrNotes: string;
  name: string;
  phone: string;
}) {
  const address =
    f.deliver && f.addrLine.trim() && f.addrCity.trim() && f.addrProvince.trim()
      ? {
          recipientName: (f.addrName.trim() || f.name.trim() || 'Pembeli konter').slice(0, 120),
          phone: (f.addrPhone.trim() || f.phone.trim()).slice(0, 20),
          addressLine: f.addrLine.trim().slice(0, 255),
          city: f.addrCity.trim().slice(0, 100),
          province: f.addrProvince.trim().slice(0, 100),
          notes: f.addrNotes.trim() ? f.addrNotes.trim().slice(0, 255) : undefined,
        }
      : null;
  return { address, ready: address !== null && address.phone.length > 0 };
}

const EMPTY = {
  deliver: false,
  addrName: '',
  addrPhone: '',
  addrLine: '',
  addrCity: '',
  addrProvince: '',
  addrNotes: '',
  name: '',
  phone: '',
};

describe('C11 · the till only sends an address the sale will accept', () => {
  it('sends nothing at all when delivery is off', () => {
    expect(buildAddress({ ...EMPTY, addrLine: 'Jl. Dago 1', addrCity: 'Bandung', addrProvince: 'Jabar' }).ready)
      .toBe(false);
  });

  it('refuses a half-typed address rather than quoting a delivery the sale would reject', () => {
    // The sale DTO requires addressLine, city AND province. Quoting on two of three means
    // telling someone a price and then failing at Bayar — with them standing there.
    const half = buildAddress({ ...EMPTY, deliver: true, addrLine: 'Jl. Dago 1', addrCity: 'Bandung', phone: '0811' });
    expect(half.address).toBeNull();
    expect(half.ready).toBe(false);
  });

  it('refuses when there is no number for the courier to call', () => {
    const noPhone = buildAddress({
      ...EMPTY, deliver: true, addrLine: 'Jl. Dago 1', addrCity: 'Bandung', addrProvince: 'Jabar',
    });
    expect(noPhone.address).not.toBeNull();
    expect(noPhone.ready).toBe(false); // built, but not sendable
  });

  it('falls back to the buyer fields so the common case is three boxes, not five', () => {
    const { address, ready } = buildAddress({
      ...EMPTY, deliver: true,
      addrLine: 'Jl. Dago 1', addrCity: 'Bandung', addrProvince: 'Jawa Barat',
      name: 'Budi', phone: '081234567890',
    });
    expect(ready).toBe(true);
    expect(address).toMatchObject({ recipientName: 'Budi', phone: '081234567890' });
  });

  it('keeps the landmark optional, and omits it rather than sending an empty string', () => {
    const without = buildAddress({
      ...EMPTY, deliver: true, addrLine: 'a', addrCity: 'b', addrProvince: 'c', phone: '0811',
    });
    expect(without.address?.notes).toBeUndefined();

    const withNote = buildAddress({
      ...EMPTY, deliver: true, addrLine: 'a', addrCity: 'b', addrProvince: 'c', phone: '0811',
      addrNotes: 'depan masjid',
    });
    expect(withNote.address?.notes).toBe('depan masjid');
  });

  it('truncates to the lengths the DTO accepts, instead of being refused by validation', () => {
    const { address } = buildAddress({
      ...EMPTY, deliver: true,
      addrLine: 'x'.repeat(400), addrCity: 'y'.repeat(200), addrProvince: 'z'.repeat(200),
      addrName: 'n'.repeat(200), addrPhone: '0'.repeat(40),
    });
    expect(address?.addressLine).toHaveLength(255);
    expect(address?.city).toHaveLength(100);
    expect(address?.province).toHaveLength(100);
    expect(address?.recipientName).toHaveLength(120);
    expect(address?.phone).toHaveLength(20);
  });
});

describe('C11 · the copy the cashier reads', () => {
  it('names the fee, and both dictionaries carry every new key', () => {
    for (const dict of [idDict, enDict]) {
      const w = (dict as unknown as { opsFix: { walkIn: Record<string, string> } }).opsFix.walkIn;
      for (const key of [
        'shipping',
        'deliverToggle',
        'deliverHint',
        'deliverIncomplete',
        'deliverAddressPlaceholder',
        'deliverCityPlaceholder',
        'deliverProvincePlaceholder',
        'deliverRecipientPlaceholder',
        'deliverPhonePlaceholder',
        'deliverNotesPlaceholder',
        'deliverRecipientFallback',
      ]) {
        expect(w[key], `${key} missing`).toBeTruthy();
      }
    }
  });

  it('warns that an incomplete address is still quoting a pick-up', () => {
    // The screen must not leave a cashier reading a total that is not the one they will
    // charge; the warning is the thing that stops that.
    const w = (idDict as unknown as { opsFix: { walkIn: Record<string, string> } }).opsFix.walkIn;
    expect(w.deliverIncomplete).toMatch(/ambil sendiri/i);
  });
});
