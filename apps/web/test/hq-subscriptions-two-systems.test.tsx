// @vitest-environment jsdom
/*
 * K1.11 · two subscription systems, one nav label, one number.
 *
 * This screen read order-service's `subscriptions/admin/summary` — the plans customers
 * start themselves — and labelled the answer "Langganan aktif" on a page called
 * "Langganan galon". Depot-created subscriptions live in depot-service and were only ever
 * listable one depot at a time, so every one of them was missing from a figure an operator
 * plans against, with nothing on screen saying so.
 *
 * A count that silently excludes a whole population is worse than no count. Both halves are
 * read now and each is labelled for what it actually counts. They are deliberately NOT
 * added together: one row is a customer's own standing order, the other is a plan a depot
 * typed in for them, and a single total would be a third wrong number.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hq/subscriptions',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

/** The customer-created half: what this screen always showed. */
const ORDER_SUMMARY = {
  activeSubscriptions: 7,
  activeSubscribers: 5,
  estMonthlyDeliveries: 28,
  plans: [{ productName: 'Air Galon 19L', frequency: 'WEEKLY', subscribers: 5 }],
};

let depotFails = false;

beforeEach(() => {
  depotFails = false;
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.startsWith('/depots/')) {
      if (depotFails) throw new Error('depot-service unreachable');
      // The half that was invisible: more depot plans than customer plans, which is
      // exactly the case where reading only one of them misleads worst.
      return { activeSubscriptions: 41, activeSubscribers: 33 };
    }
    return ORDER_SUMMARY;
  });
});
afterEach(() => vi.clearAllMocks());

describe('K1.11 · HQ counts both subscription systems, and says they are two', () => {
  it('shows the depot-created population alongside the customer-created one', async () => {
    const { default: Page } = await import('@/app/hq/subscriptions/page');
    render(<Page />, { wrapper });
    await waitFor(() => expect(screen.getByText('41')).toBeTruthy());
    expect(screen.getByText('33')).toBeTruthy();
    // The customer half is still there and still right.
    expect(screen.getByText('7')).toBeTruthy();
    // And it is no longer presented as the network's only subscriptions.
    expect(screen.getAllByText(/dua sistem terpisah/i).length).toBeGreaterThan(0);
  });

  it('never adds the two populations into one total', async () => {
    const { default: Page } = await import('@/app/hq/subscriptions/page');
    render(<Page />, { wrapper });
    await waitFor(() => expect(screen.getByText('41')).toBeTruthy());
    // 7 + 41 = 48 is the number this screen must never invent.
    expect(screen.queryByText('48')).toBeNull();
  });

  /*
   * Reading one half must not blank the other. The customer figures were readable before
   * this change and have to stay readable when depot-service is down — and the missing
   * half must show as unread, not as zero, which is the whole defect in miniature.
   */
  it('shows a dash, not a zero, when the depot figures cannot be read', async () => {
    depotFails = true;
    const { default: Page } = await import('@/app/hq/subscriptions/page');
    render(<Page />, { wrapper });
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/tidak bisa dibaca/i)).toBeTruthy();
  });
});
