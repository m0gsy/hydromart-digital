// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The staff settings screen draws a switch from what the server saved and, where nothing is
 * saved, from its own default. That default has to match admin-service's, or the screen shows a
 * switch off while the server (which now decides what the phone buzzes for) treats it as on.
 * "Ringkasan harian" is the one that used to default off on both sides; it is on now.
 */
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(async () => ({ events: [] })), put: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'KEPALA_DEPOT' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/dashboard/ops-push', () => ({ DevicePushRow: () => null }));

import { ToastProvider } from '@/components/toast';
import AccountSettingsPage from '@/app/dashboard/account/page';
import { LocaleProvider } from '@/lib/locale-context';

describe('staff alert switches with nothing saved', () => {
  it('shows every alert on, the daily summary included', async () => {
    render(
      <LocaleProvider>
        <ToastProvider>
          <AccountSettingsPage />
        </ToastProvider>
      </LocaleProvider>,
    );
    const switches = await screen.findAllByRole('switch');
    await waitFor(() => expect(switches.length).toBeGreaterThanOrEqual(3));
    for (const sw of switches.slice(0, 3)) expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});
