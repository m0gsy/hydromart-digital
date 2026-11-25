// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The maintenance reminder n8n raises reaches the depot's head and its supervisors by push and
 * by email, so their account screen carries a switch for each. A depot operator is never sent
 * it, so the row is not drawn for them.
 */
const role = vi.hoisted(() => ({ current: 'KEPALA_DEPOT' }));
const events = [
  { id: 'maintenanceDue', push: true, email: true, wa: false },
  { id: 'approval', push: true, email: false, wa: false },
];
const put = vi.hoisted(() => vi.fn<(url: string, body: { events: unknown[] }) => Promise<unknown>>());
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { get, put }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/dashboard/ops-push', () => ({ DevicePushRow: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/account',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], selected: null, selectedId: null, scopedId: null, ready: true }),
}));

import { ToastProvider } from '@/components/toast';
import AccountSettingsPage from '@/app/dashboard/account/page';
import { LocaleProvider } from '@/lib/locale-context';

const draw = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <AccountSettingsPage />
      </ToastProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  role.current = 'KEPALA_DEPOT';
  get.mockReset().mockResolvedValue({ events });
  put.mockReset();
});

describe('maintenance-due switches on /dashboard/account', () => {
  it('shows a push and an email switch, and saves each on its own channel', async () => {
    put.mockImplementation(async (_url, body) => ({ events: body.events }));
    draw();
    const email = await screen.findByRole('switch', { name: /Perawatan alat jatuh tempo \(Email\)/ });
    const push = screen.getByRole('switch', { name: /Perawatan alat jatuh tempo \(Notifikasi\)/ });
    expect(email).toHaveAttribute('aria-checked', 'true');
    expect(push).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(email);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1].events).toContainEqual({ id: 'maintenanceDue', push: true, email: false, wa: false });
    await waitFor(() => expect(email).toHaveAttribute('aria-checked', 'false'));

    fireEvent.click(push);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1]![1].events).toContainEqual({ id: 'maintenanceDue', push: false, email: false, wa: false });
  });

  it('is not drawn for a depot operator', async () => {
    role.current = 'STAFF_DEPOT';
    draw();
    await screen.findAllByRole('switch');
    expect(screen.queryByRole('switch', { name: /Perawatan alat/ })).toBeNull();
  });
});
