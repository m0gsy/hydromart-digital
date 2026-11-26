// @vitest-environment jsdom
//
// HD-23: franchise balances are no longer paid out, so a release request filed before that can only
// be closed. HQ still sees it, with why, and may reject it; the approve button is gone.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  getBlob: vi.fn(),
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'SUPER_ADMIN' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/payments',
  useSearchParams: () => new URLSearchParams(),
}));

import { ConfirmProvider } from '@/components/confirm';
import { LocaleProvider } from '@/lib/locale-context';
import HqPaymentsPage from '@/app/hq/payments/page';

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ConfirmProvider>{children}</ConfirmProvider>
  </LocaleProvider>
);

const request = {
  id: 'r1',
  franchiseOwnerId: 'o1',
  requestedBy: 'u-2',
  amountAtRequest: 500000,
  status: 'PENDING',
  createdAt: '2026-11-01T00:00:00Z',
};

beforeEach(() => {
  get.mockReset().mockImplementation(async (path: string) => (path.includes('release-requests') ? [request] : []));
});

describe('release requests filed before the royalty bill', () => {
  it('can be rejected, says why they cannot be approved, and offers no approve button', async () => {
    render(<HqPaymentsPage />, { wrapper: Wrap });
    expect(await screen.findByText(/tidak dapat disetujui lagi/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /tolak/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /setujui & rilis/i })).toBeNull();
  });
});
