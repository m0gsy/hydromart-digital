// @vitest-environment jsdom
//
// Two places ask a person to agree to the privacy policy, and both linked to it with
// `target="_blank"`. In the Android WebView that is not a link: Capacitor leaves
// `setSupportMultipleWindows` off, so the tap lands on nothing. The repo had already
// measured and written down that exact behaviour in `lib/platform.ts` — it just never
// reached these two, because they point at an internal route and so never went through
// `ExternalLink`.
//
//   register/page.tsx           "Saya setuju dengan Kebijakan Privasi"  — the consent tick
//   driver/pod-capture.tsx      the recipient's signature consent        — inside the Ops app
//
// UU PDP consent that cannot be read is the one case where a dead link is a legal problem
// and not a papercut.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/lib/locale-context';
import { PrivacyLink } from '@/components/privacy-sheet';
import { privacy } from '@/lib/dictionaries/id/privacy';

const show = (node: React.ReactElement) => render(node, { wrapper: LocaleProvider });

describe('PrivacyLink', () => {
  it('opens the policy over the page instead of navigating', () => {
    show(<PrivacyLink>Kebijakan Privasi</PrivacyLink>);
    // Closed: the words are there, the policy is not.
    expect(screen.queryByText(privacy.sections[0]!.heading)).toBeNull();

    fireEvent.click(screen.getByText('Kebijakan Privasi'));
    expect(screen.getByText(privacy.sections[0]!.heading)).toBeTruthy();
    expect(screen.getByText(privacy.intro)).toBeTruthy();
  });

  /*
   * A button, not an anchor. An anchor is what was broken: whatever the WebView does with
   * `href`+`target`, it is not "show the reader the policy". Nothing here navigates at all.
   */
  it('is not a link, so there is nothing for the WebView to swallow', () => {
    const { container } = show(<PrivacyLink>Kebijakan Privasi</PrivacyLink>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  /*
   * On the register form these words live inside the `<label>` of the consent checkbox,
   * because the whole sentence is the label. Without preventDefault a click would open
   * the policy AND tick "I agree" in one gesture — consent given by a reader who was
   * only trying to read what they were agreeing to.
   */
  it('does not tick a consent box it is nested inside', () => {
    const { container } = render(
      <LocaleProvider>
        <label>
          <input type="checkbox" />
          <PrivacyLink>Kebijakan Privasi</PrivacyLink>
        </label>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByText('Kebijakan Privasi'));
    expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
    expect(screen.getByText(privacy.sections[0]!.heading)).toBeTruthy();
  });

  it('closes again without losing the form behind it', () => {
    show(<PrivacyLink>Kebijakan Privasi</PrivacyLink>);
    fireEvent.click(screen.getByText('Kebijakan Privasi'));
    // The Android back button arrives here as an Escape (native-bridge dispatches one).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(privacy.sections[0]!.heading)).toBeNull();
  });
});

/*
 * The call sites, asserted directly.
 *
 * A component that works proves nothing about the two screens that were broken — the fix
 * is only real where the anchor used to be. This reads the files: an internal route opened
 * with `target="_blank"` is the defect, whatever it is wrapped in.
 */
describe('the consent screens', () => {
  const CONSENT_SCREENS = [
    join('src', 'app', 'register', 'page.tsx'),
    join('src', 'components', 'driver', 'pod-capture.tsx'),
  ];

  it.each(CONSENT_SCREENS)(
    '%s does not open the policy in a tab the app has no way to show',
    (file) => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      const blankToPolicy = src
        .split('\n')
        .filter((l) => l.includes('kebijakan-privasi') && l.includes('_blank'));
      expect(blankToPolicy).toEqual([]);
      expect(src).toContain('PrivacyLink');
    },
  );
});
