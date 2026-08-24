// @vitest-environment jsdom
/*
 * K2.1b · the receipt, and the operator who could not see it.
 *
 * `offlineInstruction` has always told a TRANSFER customer to keep their receipt and a
 * QRIS customer to show it to staff — with nowhere to put either. So the proof was a
 * WhatsApp message to whichever number the customer happened to have, and the depot's only
 * affordance was a "Konfirmasi lunas" button pressed blind. When the customer says they
 * paid and the depot says the money never arrived, neither side has anything to show.
 *
 * The column shipped a release ahead (#292). These are the two screens that fill and read
 * it — and the second half matters as much as the first: "belum diunggah" has to be SAID,
 * not guessed, or the operator is still confirming blind, just with a nicer panel.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, uploadFile } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/orders',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post }, uploadFile };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 's1', role: 'KEPALA_DEPOT', assignedDepotId: 'd1' }, ready: true }),
}));

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

const ORDER = {
  id: 'o-1',
  orderNumber: 'HM-1',
  status: 'PREPARING',
  total: 45000,
  customerId: 'c-1',
  items: [],
  createdAt: '2026-08-24T00:00:00.000Z',
};

/** A TRANSFER payment the customer has not backed up with anything. */
const payment = (proofUrl: string | null) => ({
  id: 'pay-1',
  orderId: 'o-1',
  customerId: 'c-1',
  method: 'TRANSFER',
  status: 'PENDING',
  amount: 45000,
  reference: null,
  instruction: null,
  proofUrl,
  createdAt: '2026-08-24T00:00:00.000Z',
});

let proofUrl: string | null = null;

beforeEach(() => {
  proofUrl = null;
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/payments/for-order/')) {
      return { items: [payment(proofUrl)], total: 1, page: 1, limit: 20 };
    }
    return { items: [], total: 0, page: 1, limit: 20 };
  });
  post.mockReset().mockResolvedValue({});
  uploadFile.mockReset().mockResolvedValue({ id: 'pay-1', proofUrl: 'https://cdn/x.png' });
});
afterEach(() => vi.clearAllMocks());

describe('K2.1b · the operator can see whether there is a receipt at all', () => {
  it('says "belum diunggah" out loud instead of leaving the panel silent', async () => {
    const { PaymentSettle } = await import('@/components/dashboard/order-detail');
    render(<PaymentSettle order={ORDER as never} />, { wrapper });
    await waitFor(() => expect(screen.getByText(/belum diunggah/i)).toBeTruthy());
    // And the blind button is still there — seeing nothing is not the same as being blocked.
    expect(screen.getByRole('button', { name: /konfirmasi lunas/i })).toBeTruthy();
  });

  it('shows the receipt once the customer has uploaded one', async () => {
    proofUrl = 'https://cdn/bukti.png';
    const { PaymentSettle } = await import('@/components/dashboard/order-detail');
    render(<PaymentSettle order={ORDER as never} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByAltText(/bukti bayar/i).getAttribute('src')).toContain('bukti.png'),
    );
    expect(screen.queryByText(/belum diunggah/i)).toBeNull();
  });

  /*
   * CASH is handed over and witnessed; EWALLET and VA are refused outright (O5). Asking an
   * operator to look for a receipt that cannot exist trains them to ignore the row.
   */
  it('asks for no receipt on a cash payment', async () => {
    get.mockImplementation(async () => ({
      items: [{ ...payment(null), method: 'CASH' }],
      total: 1,
      page: 1,
      limit: 20,
    }));
    const { PaymentSettle } = await import('@/components/dashboard/order-detail');
    render(<PaymentSettle order={ORDER as never} />, { wrapper });
    await waitFor(() => expect(screen.getByRole('button', { name: /konfirmasi lunas/i })).toBeTruthy());
    expect(screen.queryByText(/bukti bayar/i)).toBeNull();
  });
});
