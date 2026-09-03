// @vitest-environment jsdom
/**
 * OPS-03 and OPS-04 — two controls that reported work they had not done.
 *
 * OPS-03: "Bayar semua" on the depot commission screen was `onClick={() => setPaid(true)}`.
 * There was no api.post anywhere in that file. The label changed to "Terbayar", nothing was
 * recorded, no courier was paid, and a reload put the button back — so the manager who had
 * pressed it could not tell whether they had.
 *
 * OPS-04: the depot broadcast composer posted `POST /campaigns/depot`, whose own summary
 * reads "Create a draft campaign". Sending is a separate route it never called. The form
 * cleared, no error appeared, and nobody was messaged.
 *
 * Both are pinned here as behaviour: the commission screen has no pay control at all and
 * says where payment happens, and the composer sends what it drafted.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, post, getCached: get } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'depot-1', selected: { id: 'depot-1', name: 'Depot Cikini' } }),
}));

import CommissionPage from '@/app/dashboard/commission/page';
import BroadcastPage from '@/app/dashboard/broadcast/page';
import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';

function show(node: React.ReactNode) {
  render(
    <LocaleProvider>
      <ToastProvider>{node}</ToastProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset().mockResolvedValue({ id: 'camp-1' });
});
afterEach(() => vi.clearAllMocks());

describe('OPS-03 · the commission screen never claims to have paid anyone', () => {
  it('shows the total with no pay control, and says how couriers are actually paid', async () => {
    get.mockImplementation((path: string) =>
      path.includes('/commission')
        ? Promise.resolve({
            source: 'ledger',
            totalIdr: 450_000,
            couriers: [
              {
                courierId: 'c1',
                delivered: 30,
                paidDeliveries: 30,
                grossIdr: 450_000,
                shortfallIdr: 0,
              },
            ],
          })
        : Promise.resolve([]),
    );

    show(<CommissionPage />);
    // The total and the courier's own row both read 450.000 — either one proves it rendered.
    await waitFor(() => expect(screen.getAllByText(/450\.000/).length).toBeGreaterThan(0));

    expect(screen.queryByRole('button', { name: /bayar semua|pay all/i })).toBeNull();
    expect(screen.queryByText(/^Terbayar$|^Paid$/)).toBeNull();
    expect(screen.getByText(/buku pembayaran|payment ledger/i)).toBeTruthy();
  });
});

describe('OPS-04 · the depot broadcast actually sends', () => {
  it('drafts the campaign and then sends it', async () => {
    // The sent-list read wants an array; the audience-reach read wants a count.
    get.mockImplementation((path: string) =>
      path.includes('/broadcasts') ? Promise.resolve([]) : Promise.resolve({ count: 320 }),
    );

    show(<BroadcastPage />);
    await waitFor(() => expect(screen.getByText('Semua pelanggan')).toBeTruthy());

    // Pick the customer audience, fill the form, send.
    await userEvent.click(screen.getByText('Semua pelanggan'));
    const inputs = document.querySelectorAll('input, textarea');
    await userEvent.type(inputs[0] as HTMLElement, 'Promo galon');
    await userEvent.type(inputs[inputs.length - 1] as HTMLElement, 'Diskon akhir pekan');
    await userEvent.click(screen.getByRole('button', { name: /kirim/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[0]?.[0]).toBe(endpoints.crm.createDepotCampaign);
    // The call that was missing: without it the draft sat there and nobody was messaged.
    expect(post.mock.calls[1]?.[0]).toBe(endpoints.crm.sendDepotCampaign('camp-1'));
  });
});
