// @vitest-environment jsdom
//
// The refusal a franchise owner reads when their depot has no bank account.
//
// `/dashboard/payout` fails CLOSED on a blank account, which is right: a withdrawal with no
// destination used to send a hardcoded reference, so the request always "worked" and the
// money had nowhere recorded to go.
//
// What was wrong is what it SAID. The string was hardcoded, untranslated, and named no
// screen — "atur dulu di Pengaturan pembayaran" — while the setting lives behind a
// capability (`depotAdmin` = MANAGER / SUPER_ADMIN) that the franchise owner reading the
// message does not hold. A refusal the reader cannot act on is a dead end with a full stop.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/lib/locale-context';
import { opsFix as opsFixID } from '@/lib/dictionaries/id/opsFix';
import { opsFix as opsFixEN } from '@/lib/dictionaries/en/opsFix';

describe('the payout refusal names where to fix it', () => {
  it('exists in both locales', () => {
    expect(opsFixID.payout.noBankAccount).toBeTruthy();
    expect(opsFixEN.payout.noBankAccount).toBeTruthy();
  });

  /*
   * The two things the old string was missing. Not a style preference: without the screen the
   * reader does not know where to go, and without the role they go there and get a 403.
   */
  it('names the screen and the role the reader needs', () => {
    for (const copy of [opsFixID.payout.noBankAccount, opsFixEN.payout.noBankAccount]) {
      expect(copy).toMatch(/MANAGER/);
      expect(copy).toMatch(/SUPER_ADMIN/);
      expect(copy.toLowerCase()).toMatch(/depot/);
    }
  });

  // It renders through the provider like any other copy — a key that resolves to its own
  // dotted path is a missing translation showing the user `opsFix.payout.noBankAccount`.
  it('resolves through the dictionary rather than echoing its key', () => {
    function Probe() {
      return <p>{opsFixID.payout.noBankAccount}</p>;
    }
    render(<Probe />, { wrapper: LocaleProvider });
    expect(screen.queryByText('opsFix.payout.noBankAccount')).toBeNull();
    expect(screen.getByText(opsFixID.payout.noBankAccount)).toBeTruthy();
  });
});
