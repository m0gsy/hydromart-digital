// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, replace } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { get, post }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1' }, ready: true }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'o-1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  usePathname: () => '/orders/detail/review',
  useSearchParams: () => new URLSearchParams('id=o-1'),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import ReviewPage from '@/app/orders/detail/review/page';

const ORDER = {
  id: 'o-1',
  orderNumber: 'HM-0001',
  status: 'DELIVERED',
  driverName: 'Budi',
  items: [],
  history: [],
};

const EXISTING = {
  id: 'r-1',
  orderId: 'o-1',
  customerId: 'c-1',
  rating: 4,
  aspects: ['speed', 'courtesy'],
  comment: 'Kurirnya ramah, datang tepat waktu.',
  tipAmount: 0,
  createdAt: '2026-08-20T03:00:00.000Z',
};

function mock(existing: typeof EXISTING | null) {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/review')) {
      return existing ? Promise.resolve(existing) : Promise.reject(new Error('404'));
    }
    return Promise.resolve(ORDER);
  });
}

const renderPage = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <ReviewPage />
      </ToastProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  replace.mockReset();
});
afterEach(() => vi.clearAllMocks());

/**
 * H12. The form collected a tip — "Beri tip kurir? · Opsional, langsung ke kurir" — wrote
 * it to `order_reviews.tipAmount`, and then nothing on earth read it. It was never
 * charged, never confirmed, never shown again, and never reached the courier the copy
 * promised it went straight to. Payment in this product goes direct to the depot with no
 * gateway, so there is no path that could ever have billed it.
 *
 * Measured in production on 22 Aug 2026: 0 reviews, 0 tips, Rp 0. Nobody has been shorted
 * yet — the first person to tip would have been.
 *
 * The control is withdrawn rather than half-built. The column stays (zero rows, so no
 * migration) and the server still accepts the field, so nothing that already shipped
 * breaks; what goes is the promise the app could not keep.
 */
describe('H12 — the tip nobody was ever going to be paid', () => {
  it('makes no offer to tip', async () => {
    mock(null);
    renderPage();

    await screen.findByText(/bagaimana antaran|how was/i);
    expect(screen.queryByText(/tip/i)).toBeNull();
  });

  it('sends no tip field when the review is submitted', async () => {
    mock(null);
    renderPage();

    const stars = await screen.findAllByRole('button', { name: /bintang|star/i });
    await userEvent.click(stars[3]!);
    await userEvent.click(screen.getByRole('button', { name: /kirim ulasan|send review/i }));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('tipAmount');
  });
});

/**
 * H13. The page already FETCHED the existing review — it needed it to know whether to show
 * the form — and then threw the contents away, printing "Pesanan ini sudah dinilai." and
 * nothing else. The customer could not read back what they had said, on the one screen
 * that had it in hand.
 */
describe('H13 — reading back a review already sent', () => {
  it('shows the rating that was given', async () => {
    mock(EXISTING);
    renderPage();

    const stars = await screen.findAllByTestId('review-star-filled');
    expect(stars).toHaveLength(4);
  });

  it('shows the comment that was written', async () => {
    mock(EXISTING);
    renderPage();

    expect(await screen.findByText('Kurirnya ramah, datang tepat waktu.')).toBeInTheDocument();
  });

  it('shows the aspects that were ticked', async () => {
    mock(EXISTING);
    renderPage();

    expect(await screen.findByText(/kecepatan antar/i)).toBeInTheDocument();
    expect(await screen.findByText(/keramahan kurir/i)).toBeInTheDocument();
    expect(screen.queryByText(/kondisi galon/i)).toBeNull();
  });

  it('offers no second review of the same order', async () => {
    mock(EXISTING);
    renderPage();

    await screen.findByText('Kurirnya ramah, datang tepat waktu.');
    expect(screen.queryByRole('button', { name: /kirim ulasan|send review/i })).toBeNull();
  });
});
