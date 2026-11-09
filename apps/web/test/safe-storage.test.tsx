// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingTour } from '@/components/onboarding-tour';
import { LocaleProvider } from '@/lib/locale-context';
import { safeStorage } from '@/lib/safe-storage';
import { setSession } from '@/lib/session-store';
import { ThemeProvider } from '@/lib/theme-context';

/** WEB-14: a browser that blocks storage must not crash the root providers. */
function blockStorage() {
  const boom = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as never;
});
afterEach(() => vi.restoreAllMocks());

describe('safeStorage', () => {
  it('reads and writes normally when storage works', () => {
    safeStorage.set('k', 'v');
    expect(safeStorage.get('k')).toBe('v');
    safeStorage.remove('k');
    expect(safeStorage.get('k')).toBeNull();
  });

  it('answers null and swallows writes when storage throws', () => {
    blockStorage();
    expect(safeStorage.get('k')).toBeNull();
    expect(() => safeStorage.set('k', 'v')).not.toThrow();
    expect(() => safeStorage.remove('k')).not.toThrow();
  });
});

describe('root providers with storage blocked', () => {
  it('locale and theme providers still render their children', () => {
    blockStorage();
    render(
      <LocaleProvider>
        <ThemeProvider>
          <p>app is up</p>
        </ThemeProvider>
      </LocaleProvider>,
    );
    expect(screen.getByText('app is up')).toBeTruthy();
  });

  it('the onboarding tour shows (nothing is remembered as seen) instead of throwing', () => {
    blockStorage();
    expect(() =>
      render(
        <LocaleProvider>
          <OnboardingTour />
        </LocaleProvider>,
      ),
    ).not.toThrow();
  });

  it('setSession keeps the in-memory session when it cannot be cached', () => {
    blockStorage();
    expect(() => setSession(null)).not.toThrow();
  });
});
