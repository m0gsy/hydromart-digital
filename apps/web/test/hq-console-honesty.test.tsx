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

describe('the switchboard says which switches move something (flow 5d)', () => {
  const row = (key: string, label: string) => ({ key, label, description: '', state: 'ACTIVE', rolloutPct: null });
  beforeEach(() => {
    get.mockImplementation((url: string) =>
      String(url).includes('feature-flags')
        ? Promise.resolve([
            row('attendance.courier_one_tap', 'Check-in kurir satu tap'),
            row('franchise_portal', 'Portal franchise'),
          ])
        : Promise.resolve({ defaultTimezone: 'Asia/Jakarta', currency: 'IDR', serviceRadiusKm: 10 }),
    );
  });

  it('marks only the rows nothing reads; an enforced one (the one-tap brake) carries no warning', async () => {
    getCached.mockResolvedValue([{ key: 'attendance.courier_one_tap', enabled: true }]);
    render(<HqFlagsPage />, { wrapper: LocaleProvider });
    const brake = (await screen.findByText('Check-in kurir satu tap')).parentElement as HTMLElement;
    const other = screen.getByText('Portal franchise').parentElement as HTMLElement;
    await waitFor(() => expect(other.textContent).toMatch(/Belum ditegakkan/));
    expect(brake.textContent).not.toMatch(/Belum ditegakkan/);
  });

  it('keeps the warning over the whole board when it cannot tell which keys are read', async () => {
    getCached.mockRejectedValue(new Error('down'));
    render(<HqFlagsPage />, { wrapper: LocaleProvider });
    await screen.findByText('Check-in kurir satu tap');
    expect(await screen.findAllByText(/Belum ditegakkan/)).toHaveLength(1);
  });
});

/*
 * HD-7. The signing secret is readable once, at registration, and the sheet used to refresh the
 * list the moment it arrived: the page turned into its skeleton, the sheet unmounted, and the
 * secret went with it. Every endpoint registered here had a secret nobody ever saw.
 */
describe('the one-time signing secret stays on screen until it is dismissed (HD-7)', () => {
  const SECRET = 'f'.repeat(64);
  const listReads = () => get.mock.calls.filter(([u]) => !String(u).includes('deliveries')).length;

  it('shows the secret after registering, and refreshes the list only when it is dismissed', async () => {
    post.mockResolvedValue({ id: 'w-9', secret: SECRET });
    render(<HqWebhooksPage />, { wrapper: LocaleProvider });

    await userEvent.click(await screen.findByRole('button', { name: /Endpoint/ }));
    await userEvent.type(screen.getByLabelText('URL endpoint'), 'https://ai.example.com/api/ingress/hd');
    await userEvent.type(screen.getByLabelText('Event'), 'franchise.application_submitted');
    const before = listReads();
    // The sheet's own submit button shares the header button's label; it is rendered last.
    await userEvent.click(screen.getAllByRole('button', { name: /Endpoint/ }).at(-1)!);

    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(post.mock.calls[0]![1]).toEqual({
      url: 'https://ai.example.com/api/ingress/hd',
      events: ['franchise.application_submitted'],
    });
    expect(listReads()).toBe(before);
    // Only the secret: no form to register a second endpoint over it, focus on the way out.
    expect(screen.queryByLabelText('URL endpoint')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(SECRET);
    expect(document.activeElement?.textContent).toBe('Sudah saya salin');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await userEvent.click(screen.getByRole('button', { name: 'Salin' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(toast).toHaveBeenCalledWith('Secret disalin', 'success');
    toast.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Sudah saya salin' }));
    await waitFor(() => expect(listReads()).toBe(before + 1));
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(toast).toHaveBeenCalledWith('Endpoint webhook ditambahkan', 'success');
  });

  // The normal workflow: open the AI web's env in another window, come back to copy the secret.
  it('keeps the secret through a refresh after the tab was away, and through Escape', async () => {
    post.mockResolvedValue({ id: 'w-9', secret: SECRET });
    render(<HqWebhooksPage />, { wrapper: LocaleProvider });
    await userEvent.click(await screen.findByRole('button', { name: /Endpoint/ }));
    await userEvent.type(screen.getByLabelText('URL endpoint'), 'https://ai.example.com/api/ingress/hd');
    await userEvent.type(screen.getByLabelText('Event'), 'franchise.application_submitted');
    await userEvent.click(screen.getAllByRole('button', { name: /Endpoint/ }).at(-1)!);
    expect(await screen.findByText(SECRET)).toBeTruthy();

    const before = listReads();
    const realNow = Date.now.bind(Date);
    const visibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    visibility('hidden');
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
    try {
      visibility('visible');
      // useAsync refetches after a minute away; the page must stay mounted while it does.
      await waitFor(() => expect(listReads()).toBe(before + 1));
    } finally {
      clock.mockRestore();
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
    expect(screen.getByText(SECRET)).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText(SECRET)).toBeTruthy();
  });

  it('cannot be closed while the create is still in flight', async () => {
    let answer: (v: unknown) => void = () => undefined;
    post.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<HqWebhooksPage />, { wrapper: LocaleProvider });
    await userEvent.click(await screen.findByRole('button', { name: /Endpoint/ }));
    await userEvent.type(screen.getByLabelText('URL endpoint'), 'https://ai.example.com/api/ingress/hd');
    await userEvent.type(screen.getByLabelText('Event'), 'franchise.application_submitted');
    await userEvent.click(screen.getAllByRole('button', { name: /Endpoint/ }).at(-1)!);
    await userEvent.keyboard('{Escape}');
    // Still open: the create lands in a sheet somebody is looking at.
    expect(screen.getByLabelText('URL endpoint')).toBeTruthy();
    answer({ id: 'w-9', secret: SECRET });
    expect(await screen.findByText(SECRET)).toBeTruthy();
  });

  it('closes without a refresh when nothing was registered', async () => {
    render(<HqWebhooksPage />, { wrapper: LocaleProvider });
    await userEvent.click(await screen.findByRole('button', { name: /Endpoint/ }));
    const before = listReads();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await waitFor(() => expect(screen.queryByLabelText('URL endpoint')).toBeNull());
    expect(listReads()).toBe(before);
    expect(toast).not.toHaveBeenCalled();
  });

  it('filters the delivery log by event, so an older franchise delivery can be found', async () => {
    render(<HqWebhooksPage />, { wrapper: LocaleProvider });
    const filter = await screen.findByRole('group', { name: 'Saring riwayat menurut event' });
    expect(filter).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Lamaran waralaba' }));
    expect(screen.getByRole('button', { name: 'Lamaran waralaba' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Semua' }).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() =>
      expect(
        get.mock.calls.some(([u]) => String(u).includes('event=franchise.application_submitted')),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Semua' }));
    const last = String(get.mock.calls.at(-1)![0]);
    expect(last).toContain('deliveries?limit=50');
    expect(last).not.toContain('event=');
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
