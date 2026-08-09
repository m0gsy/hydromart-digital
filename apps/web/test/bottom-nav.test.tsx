// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let customer: { role: string } | null = null;

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
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
