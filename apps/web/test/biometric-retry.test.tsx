// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BiometricRetry } from '@/components/biometric-retry';
import { LocaleProvider } from '@/lib/locale-context';

/*
 * The way back from a dismissed unlock prompt, and the one line in it that matters: WHERE
 * it sends the browser.
 *
 * `location.reload()` here asked the WebView for `/login/`, whose Capacitor SPA fallback
 * answers with the HOME document while the URL keeps saying `/login/` — React then hydrates
 * home markup against the login route, throws the tree away (#418) and rebuilds the whole
 * root, wiping the plugin's safe-area insets off <html> on the way. It is the only reload in
 * the customer app, so this is the only place that can regress it.
 */
// `vi.hoisted` because `vi.mock` is lifted above the imports and its factory may not close
// over a plain `const` declared here.
const store = vi.hoisted(() => ({
  unlockWasCancelled: vi.fn(() => true),
  retryUnlock: vi.fn(async () => {}),
  hasTokens: vi.fn(() => true),
}));
vi.mock('@/lib/token-store', () => store);

function renderRetry() {
  const location = { replace: vi.fn(), reload: vi.fn(), assign: vi.fn(), href: '/login/' };
  vi.stubGlobal('location', location);
  render(
    <LocaleProvider>
      <BiometricRetry />
    </LocaleProvider>,
  );
  return location;
}

describe('BiometricRetry', () => {
  it('a successful unlock leaves /login by loading home, never by reloading it', async () => {
    const location = renderRetry();

    fireEvent.click(screen.getByRole('button', { name: /Buka sesi tersimpan/i }));

    await waitFor(() => expect(location.replace).toHaveBeenCalledWith('/'));
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('an unlock that produced no session stays put and says so', async () => {
    store.hasTokens.mockReturnValueOnce(false);
    const location = renderRetry();

    fireEvent.click(screen.getByRole('button', { name: /Buka sesi tersimpan/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(location.replace).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
  });

  it('renders nothing when the unlock was never cancelled', () => {
    store.unlockWasCancelled.mockReturnValueOnce(false);
    const { container } = render(
      <LocaleProvider>
        <BiometricRetry />
      </LocaleProvider>,
    );

    expect(container.textContent).toBe('');
  });
});
