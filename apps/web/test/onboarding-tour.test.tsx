/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingTour } from '@/components/onboarding-tour';

// The tour reads its copy through `useT`, which needs the provider. Mocked rather than
// wrapped: the dictionary is not what is under test here, the back button is.
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ locale: 'id', t: (key: string) => key }),
}));

/**
 * E10 — the hardware back button must close the first-run tour, not navigate past it.
 *
 * `native-bridge.tsx` routes a back press like this: if anything on screen carries
 * `aria-modal="true"`, dispatch Escape and stop; otherwise walk history. Every other
 * overlay in the app (`overlay.tsx`, `command-palette.tsx`) closes on Escape, so that one
 * rule covers all of them without naming any. The tour was the outlier — no `aria-modal`,
 * so back navigated the page out from under an open tour.
 *
 * The trap this file exists to pin: adding `aria-modal` ALONE makes it worse. The tour has
 * no Escape handler, so back would stop navigating and do nothing at all — a dead button
 * instead of a wrong one. Both halves or neither.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the first-run tour and the back button', () => {
  it('marks itself as a modal so the back handler can find it', async () => {
    render(<OnboardingTour />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape — the key the back handler actually sends', async () => {
    render(<OnboardingTour />);
    await screen.findByRole('dialog');
    // Dispatched on `document`, bubbling, exactly as native-bridge does it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not come back after being dismissed with Escape', async () => {
    const { unmount } = render(<OnboardingTour />);
    await screen.findByRole('dialog');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    unmount();

    // A tour that reappears on the next screen is the same annoyance the "seen" flag
    // exists to prevent — Escape has to count as dismissal, like Lewati does.
    render(<OnboardingTour />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays put for any other key', async () => {
    render(<OnboardingTour />);
    await screen.findByRole('dialog');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
});
