// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let customer: { role: string } | null = null;

const prefetch = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ prefetch }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready: true }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
// The bar only listens for the keyboard inside the shell; the jsdom origin here is a
// browser one, so the switch is mocked rather than the whole file moved to https://localhost.
vi.mock('@/lib/platform', () => ({ isNativeShell: () => true }));

import { BottomNav } from '@/components/bottom-nav';

type Listener = (payload: unknown) => void;
const listeners: Record<string, Listener> = {};

beforeEach(() => {
  for (const key of Object.keys(listeners)) delete listeners[key];
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    Plugins: {
      Keyboard: {
        addListener: async (event: string, handler: Listener) => {
          listeners[event] = handler;
          return { remove: () => {} };
        },
      },
    },
  };
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.clearAllMocks();
});

describe('BottomNav', () => {
  it('shows the shop tabs to a customer', () => {
    customer = { role: 'CUSTOMER' };
    render(<BottomNav />);
    expect(screen.getByText('nav.shop')).toBeTruthy();
    expect(screen.getByText('nav.orders')).toBeTruthy();
  });

  it('shows the shop tabs to a signed-out visitor', () => {
    customer = null;
    render(<BottomNav />);
    expect(screen.getByText('nav.shop')).toBeTruthy();
  });

  it('gives staff their console instead of shop/cart tabs', () => {
    customer = { role: 'SUPER_ADMIN' };
    render(<BottomNav />);
    expect(screen.queryByText('nav.shop')).toBeNull();
    expect(screen.queryByText('nav.orders')).toBeNull();
    expect(screen.getByText('nav.ops').closest('a')?.getAttribute('href')).toBe('/hq');
  });

  it('points a courier at the driver app', () => {
    customer = { role: 'STAFF_DEPOT' };
    render(<BottomNav />);
    expect(screen.getByText('nav.ops').closest('a')?.getAttribute('href')).toBe('/driver');
  });

  // Checklist item 10: Android shrinks the WebView for the keyboard, so a bar fixed to
  // the bottom lands on top of it and covers the field being typed into.
  it('gets out of the way of the soft keyboard, and comes back', async () => {
    customer = { role: 'CUSTOMER' };
    render(<BottomNav />);
    // The listener is registered through a promise, so it exists a microtask after mount.
    await vi.waitFor(() => expect(listeners.keyboardWillShow).toBeTypeOf('function'));

    act(() => listeners.keyboardWillShow!({}));
    expect(screen.queryByText('nav.shop')).toBeNull();

    act(() => listeners.keyboardDidHide!({}));
    expect(screen.getByText('nav.shop')).toBeTruthy();
  });
});

/*
 * Prefetch on intent, not on sight — and this test exists because the cost was invisible.
 *
 * Next's App Router prefetches a <Link> as soon as it enters the viewport. This bar is always
 * in the viewport, so every page load pulled the RSC payload and chunks for all four tabs.
 * Measured against production with Playwright (Moto G4 emulation, 4 loads): the home page made
 * 44 requests and 18 of them — 41% — were prefetches of other routes; 13 came from this bar.
 * Nothing in the codebase said so, and no gate could see it: they are requests a browser makes,
 * not bytes a bundle carries.
 *
 * The trade is deliberate. `prefetch={false}` alone would cost the warm cache on the navigation
 * this bar exists for, so the prefetch moves to the first sign of intent instead — touchstart
 * lands roughly 100ms before the tap completes.
 */
describe('the tab bar warms routes on intent, not on sight', () => {
  it('prefetches nothing until the user reaches for a tab', () => {
    prefetch.mockClear();
    render(<BottomNav />);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('warms the route the thumb lands on', () => {
    prefetch.mockClear();
    render(<BottomNav />);
    fireEvent.touchStart(screen.getByText('nav.orders'));
    expect(prefetch).toHaveBeenCalledWith('/orders');
  });

  it('warms on hover too, for the pointer case', () => {
    prefetch.mockClear();
    render(<BottomNav />);
    fireEvent.mouseEnter(screen.getByText('nav.account'));
    expect(prefetch).toHaveBeenCalledWith('/account');
  });

  it('every tab carries the intent handlers, so none silently goes back to eager', () => {
    // The failure this guards is a new tab added without the two props — it would prefetch on
    // sight again and nothing else here would notice.
    prefetch.mockClear();
    render(<BottomNav />);
    for (const label of ['nav.home', 'nav.shop', 'nav.orders', 'nav.account']) {
      fireEvent.touchStart(screen.getByText(label));
    }
    expect(prefetch).toHaveBeenCalledTimes(4);
  });
});
