// @vitest-environment jsdom
/*
 * PPA-15. The transfer worklist (every PROCESSING withdrawal with its verified bank account) was
 * built server-side and audited per download, with nothing in the console to ask for it. The
 * finance role that releases the money gets a button for it next to the queue it exports.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getBlob, downloadBlob, toast, role } = vi.hoisted(() => ({
  get: vi.fn(),
  getBlob: vi.fn(),
  downloadBlob: vi.fn(),
  toast: vi.fn(),
  role: { value: 'FINANCE' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  getBlob,
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/csv', async (orig) => ({ ...(await orig<typeof import('@/lib/csv')>()), downloadBlob }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.value }, ready: true }),
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

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  getBlob.mockReset().mockResolvedValue(new Blob(['a,b']));
  downloadBlob.mockReset();
  toast.mockReset();
  role.value = 'FINANCE';
});
afterEach(() => vi.clearAllMocks());

describe('PPA-15 the transfer worklist button', () => {
  it('downloads the CSV from the export route', async () => {
    render(<HqPaymentsPage />, { wrapper: Wrap });
    await userEvent.click(await screen.findByRole('button', { name: /unduh daftar transfer/i }));
    await waitFor(() => expect(getBlob).toHaveBeenCalled());
    expect(String(getBlob.mock.calls[0]?.[0])).toContain('/hq/withdrawals/processing/export.csv');
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
    expect(String(downloadBlob.mock.calls[0]?.[0])).toMatch(/\.csv$/);
  });

  it('says so when the download fails', async () => {
    getBlob.mockRejectedValue(new Error('403'));
    render(<HqPaymentsPage />, { wrapper: Wrap });
    await userEvent.click(await screen.findByRole('button', { name: /unduh daftar transfer/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('is not offered to a role that may not pay', async () => {
    role.value = 'HEAD_OFFICE';
    render(<HqPaymentsPage />, { wrapper: Wrap });
    await screen.findAllByText(/penarikan/i);
    expect(screen.queryByRole('button', { name: /unduh daftar transfer/i })).toBeNull();
  });
});
