// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class FakeApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, post, getCached: get }, ApiError: FakeApiError }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'd1', selected: { id: 'd1', name: 'Depot' }, depots: [], ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/returns',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import ReturnsPage from '@/app/dashboard/returns/page';

/**
 * DEP-07. The manual return form sent no key, so a double-tapped "Simpan retur" booked the
 * deposit refund twice. One key per submission, kept across a failed send and dropped once the
 * server accepted it; a changed form is a different submission and gets its own.
 */
describe('/dashboard/returns — recording a return is idempotent per submission', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('summary')) return Promise.resolve({ returns: 0, gallons: 0, damaged: 0, depositRefunded: 0, issued: 0, depositHeld: 0 });
      return Promise.resolve({ items: [], total: 0 });
    });
    post.mockReset();
  });

  const renderIt = () =>
    render(
      <LocaleProvider>
        <ReturnsPage />
      </LocaleProvider>,
    );

  async function save(qty: string) {
    const qtyInput = await screen.findByLabelText(/jumlah galon/i);
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, qty);
    await userEvent.click(screen.getByRole('button', { name: /simpan retur/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  }
  const keys = () =>
    post.mock.calls.map((c) => (c[1] as { idempotencyKey?: string }).idempotencyKey);

  it('re-sends the SAME key after a failed attempt', async () => {
    post.mockRejectedValueOnce(new FakeApiError('timeout', 504)).mockResolvedValue({});
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /catat retur/i }));
    await save('2');
    await userEvent.click(screen.getByRole('button', { name: /simpan retur/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(typeof keys()[0]).toBe('string');
    expect(keys()[1]).toBe(keys()[0]);
  });

  it('uses a different key once the form was changed', async () => {
    post.mockRejectedValue(new FakeApiError('timeout', 504));
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /catat retur/i }));
    await save('2');
    const qtyInput = screen.getByLabelText(/jumlah galon/i);
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '3');
    await userEvent.click(screen.getByRole('button', { name: /simpan retur/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(keys()[1]).not.toBe(keys()[0]);
  });
});
