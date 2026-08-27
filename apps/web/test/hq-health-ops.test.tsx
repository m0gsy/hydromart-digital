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

beforeEach(() => {
  toast.mockReset();
  post.mockReset().mockResolvedValue({ delivered: 4, failed: 1, ingested: 120 });
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/outbox/pending')) return Promise.resolve({ PENDING: 7, DONE: 900, DEAD: 2 });
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
