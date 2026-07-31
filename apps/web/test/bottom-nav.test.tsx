// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let customer: { role: string } | null = null;

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready: true }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

import { BottomNav } from '@/components/bottom-nav';

afterEach(() => vi.clearAllMocks());

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
});
