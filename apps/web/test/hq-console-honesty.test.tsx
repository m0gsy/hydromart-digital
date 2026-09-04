// @vitest-environment jsdom
/*
 * Five HQ screens that showed a control, a number, or a queue that was not what it looked
 * like.
 *
 * CA-2-07  a switchboard wired to nothing, seeded with "Cash on delivery: MATI"
 * CA-2-11  the platform fee read 0% for every role that could not read the settings
 * CA-2-42  an approval queue with no producer, whose empty state read as a quiet day
 * CA-2-43  a delivery log and a replay button that shipped and were never called
 * CA-2-45  a pending payment could only be confirmed, never marked failed
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, patch, toast, role } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  toast: vi.fn(),
  role: { current: 'SUPER_ADMIN' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, patch, del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import HqFlagsPage from '@/app/hq/flags/page';
import HqWebhooksPage from '@/app/hq/webhooks/page';

beforeEach(() => {
  role.current = 'SUPER_ADMIN';
  get.mockReset().mockResolvedValue([]);
  getCached.mockReset().mockResolvedValue([]);
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('the feature-flag switchboard admits it governs nothing (CA-2-07)', () => {
  it('says the flags are not enforced, above the switches', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('feature-flags')
        ? Promise.resolve([
            {
              key: 'payments.cash_on_delivery',
              label: 'Cash on delivery',
              description: 'COD at delivery time',
              state: 'ACTIVE',
              rolloutPct: null,
            },
          ])
        : Promise.resolve({
            defaultTimezone: 'Asia/Jakarta',
            currency: 'IDR',
            serviceRadiusKm: 10,
          }),
    );

    render(<HqFlagsPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/Belum ditegakkan/)).toBeTruthy();
    expect(screen.getByText(/tidak menyalakan atau mematikan apa pun/i)).toBeTruthy();
  });
});

describe('the webhook delivery log has a door (CA-2-43)', () => {
  const DELIVERY = {
    id: '11111111-1111-4111-8111-111111111111',
    endpointId: '22222222-2222-4222-8222-222222222222',
    event: 'order.created',
    payload: {},
    status: 'DEAD',
    attempts: 6,
    nextAttemptAt: '2026-08-10T03:00:00.000Z',
    responseStatus: 500,
    lastError: 'connect ETIMEDOUT',
    occurredAt: '2026-08-10T03:00:00.000Z',
    deliveredAt: null,
  };

  const serve = () =>
    get.mockImplementation((url: string) =>
      String(url).includes('deliveries') ? Promise.resolve([DELIVERY]) : Promise.resolve([]),
    );

  it('lists what was sent, why it failed, and offers to send it again', async () => {
    serve();
    render(<HqWebhooksPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText('order.created')).toBeTruthy();
    // The reason is the whole value of a log: without it an operator can only press the
    // button again and hope.
    expect(screen.getByText(/connect ETIMEDOUT/)).toBeTruthy();
    expect(screen.getByText('DEAD')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /kirim ulang/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('/replay');
  });

  it('offers no replay for a delivery that already landed', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('deliveries')
        ? Promise.resolve([
            {
              ...DELIVERY,
              status: 'DELIVERED',
              lastError: null,
              deliveredAt: '2026-08-10T03:01:00.000Z',
            },
          ])
        : Promise.resolve([]),
    );

    render(<HqWebhooksPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText('DELIVERED')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /kirim ulang/i })).toBeNull();
  });

  it('keeps the endpoint list alive when the log cannot be read', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('deliveries')
        ? Promise.reject(new Error('503'))
        : Promise.resolve([
            {
              id: 'w-1',
              url: 'https://partner.example/hook',
              events: ['order.created'],
              active: true,
              deliveryRate: null,
            },
          ]),
    );

    render(<HqWebhooksPage />, { wrapper: LocaleProvider });

    // The list is what an operator came here to manage; a failed log must not take it down.
    expect(await screen.findByText(/partner.example/)).toBeTruthy();
    // The two reads land independently, so the log's failure can arrive after the list.
    expect(await screen.findByText(/Gagal memuat riwayat pengiriman/)).toBeTruthy();
  });
});

/*
 * CA-2-42 used to be tested here: the HQ voucher-request queue explained why it was empty,
 * because nothing anywhere raised a request.
 *
 * The owner settled it on 2026-09-04 — a depot manager may create vouchers for their own
 * depot, and the approval queue is gone. There is no screen left to assert on, so the test
 * went with it rather than being weakened into something that still passes. What replaced
 * it is the absence itself: `check-endpoint-contracts` fails if the endpoints come back
 * with no caller, and `check-route-parity` fails if the route does.
 */
