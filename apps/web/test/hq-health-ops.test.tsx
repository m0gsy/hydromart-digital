// @vitest-environment jsdom
//
// Three admin routes that existed to fix a stuck system and were reachable from no screen,
// so the only way to run any of them was a hand-made HTTP request:
//
//   GET  /orders/outbox/pending          the gauge, written "so a queue that stops
//                                        draining is visible" — and visible to nobody
//   POST /orders/outbox/process          the manual drain beside it
//   POST /forecast/rebuild               read-model backfills for a model that has
//   POST /recommendations/rebuild        drifted, or was never populated at all
//
// A PENDING outbox row is money that has not been booked: a stock consume, a loyalty
// award, a referral qualification, an owner's commission. The happy path delivers these
// inline, so a queue that stops draining looks exactly like a quiet week.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, toast } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, post }, ApiError: class extends Error {} }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/health',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import HqHealthPage from '@/app/hq/health/page';

const HEALTH = {
  services: [{ name: 'order', status: 'up', latencyMs: 12 }],
  upCount: 1,
  total: 1,
};

/*
 * CA-5-01. The four states the seventeen scheduled sweeps can be in, and the fourth is the
 * one that used to be invisible: a job that has NEVER reported. The old per-job marker
 * files could not express it — an absent file and a job with nothing to do looked
 * identical — and the container healthcheck read one shared file as a single yes/no for all
 * seventeen at once.
 */
const SWEEPS = [
  {
    job: 'webhooks/deliveries/process',
    label: 'Webhook mitra',
    everyMinutes: 5,
    verdict: 'NEVER_RAN',
    dormantReason: null,
    lastRunAt: null,
    lastOkAt: null,
    ok: null,
    detail: null,
    consecutiveFailures: 0,
    host: null,
    overdueAfterMinutes: 15,
  },
  {
    job: 'orders/outbox/internal/process',
    label: 'Efek pesanan tertunda',
    everyMinutes: 10,
    verdict: 'FAILING',
    dormantReason: null,
    lastRunAt: new Date(Date.now() - 60_000).toISOString(),
    lastOkAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    ok: false,
    detail: 'ronde mati: 0 dari 40 berhasil',
    consecutiveFailures: 12,
    host: 'order:3004',
    overdueAfterMinutes: 25,
  },
  {
    job: 'subscriptions/process-due',
    label: 'Langganan jatuh tempo',
    everyMinutes: 60,
    verdict: 'OK',
    dormantReason: null,
    lastRunAt: new Date(Date.now() - 120_000).toISOString(),
    lastOkAt: new Date(Date.now() - 120_000).toISOString(),
    ok: true,
    detail: null,
    consecutiveFailures: 0,
    host: 'order:3004',
    overdueAfterMinutes: 125,
  },
  {
    job: 'loyalty/internal/expire',
    label: 'Kedaluwarsa poin',
    everyMinutes: 1440,
    verdict: 'DORMANT',
    dormantReason: 'Sengaja dimatikan (keputusan pemilik 2 September 2026).',
    lastRunAt: new Date(Date.now() - 3600_000).toISOString(),
    lastOkAt: null,
    ok: true,
    detail: null,
    consecutiveFailures: 0,
    host: 'loyalty:3010',
    overdueAfterMinutes: 2885,
  },
];

beforeEach(() => {
  toast.mockReset();
  post.mockReset().mockResolvedValue({ delivered: 4, failed: 1, ingested: 120 });
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/outbox/pending')) return Promise.resolve({ PENDING: 7, DONE: 900, DEAD: 2 });
    if (p.includes('/sweeps')) return Promise.resolve(SWEEPS);
    return Promise.resolve(HEALTH);
  });
});

afterEach(() => vi.clearAllMocks());

const open = () => {
  const user = userEvent.setup();
  render(<HqHealthPage />, { wrapper: LocaleProvider });
  return user;
};

describe('/hq/health · the outbox gauge (PAR-09)', () => {
  it('shows what the queue still owes', async () => {
    open();
    // The three counts, and PENDING is the one that means money not yet booked.
    expect(await screen.findByText('7')).toBeTruthy();
    expect(await screen.findByText('2')).toBeTruthy();
    expect(await screen.findByText('900')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('/outbox/pending'))).toBe(true);
  });

  it('drains on demand and re-reads the gauge afterwards', async () => {
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Tiriskan sekarang' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('/outbox/process');
    // Reporting the counts back matters: "sweep ran" with no numbers cannot tell a drained
    // queue from one that failed every row.
    await waitFor(() =>
      expect(toast.mock.calls.some((c) => String(c[0]).includes('4'))).toBe(true),
    );
    await waitFor(() =>
      expect(
        get.mock.calls.filter((c) => String(c[0]).includes('/outbox/pending')).length,
      ).toBeGreaterThan(1),
    );
  });
});

describe('/hq/health · read-model backfills', () => {
  it('rebuilds the forecast model', async () => {
    const user = open();
    const buttons = await screen.findAllByRole('button', { name: /Bangun ulang/ });
    await user.click(buttons[0]!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('/forecast/rebuild');
  });

  it('rebuilds the recommendation model through the gateway segment it is actually served on', async () => {
    const user = open();
    const buttons = await screen.findAllByRole('button', { name: /Bangun ulang/ });
    await user.click(buttons[1]!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    // `/recommendations/`, plural — the gateway maps that segment, and the singular form
    // resolves to no route at all. It was written singular first.
    expect(String(post.mock.calls[0]![0])).toContain('/recommendations/api/v1/');
  });
});

/*
 * CA-5-01 — seventeen scheduled sweeps that ran with nobody watching.
 *
 * Measured on the dev box the day this shipped: FailingStreak 1472, every sweep failing for
 * ~25 hours, and two jobs with no marker file of EITHER kind. Learning any of it needed
 * `docker inspect`.
 */
describe('/hq/health · the scheduled sweeps (CA-5-01)', () => {
  it('names a sweep that has never run, rather than leaving it out', async () => {
    open();
    expect(await screen.findByText('Webhook mitra')).toBeTruthy();
    expect(await screen.findByText('Belum pernah jalan')).toBeTruthy();
  });

  it('shows "last run" and "last succeeded" as different answers', async () => {
    open();
    // The shape the old shared heartbeat rendered as perfectly healthy: ran a minute ago,
    // last actually worked three days ago.
    expect(await screen.findByText('1 menit lalu')).toBeTruthy();
    expect(await screen.findByText('3 hari lalu')).toBeTruthy();
  });

  it('counts the failing streak and quotes what the round said', async () => {
    open();
    expect(await screen.findByText('12 kali gagal berturut-turut')).toBeTruthy();
    expect(await screen.findByText(/ronde mati/)).toBeTruthy();
  });

  it('says a deliberately-off sweep is off, and why', async () => {
    open();
    expect(await screen.findByText('Sengaja dimatikan')).toBeTruthy();
    // Without the reason the quiet row reads as a fault — and "fixing" this particular one
    // writes permanently to every customer's points balance.
    expect(await screen.findByText(/keputusan pemilik/)).toBeTruthy();
  });

  it('counts the broken ones in the header, and does not count the dormant one', async () => {
    open();
    // 2 of 4: NEVER_RAN and FAILING. OK and DORMANT are not problems.
    expect(await screen.findByText('2 dari 4 sapuan bermasalah')).toBeTruthy();
  });
});
