// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hqItemsForRole } from '@/lib/hq-nav';

/**
 * CA-2-61: on a phone, the HQ tab bar WAS the console's whole navigation.
 *
 * The rail is `hidden lg:flex` and the command palette opens on Ctrl+K or a rail button,
 * so the four hard-coded tabs were the only doors a phone had into sixty-four screens.
 * One of those four was dead for almost everybody: `/hq/access` needs `accessMatrixWrite`,
 * which is SUPER_ADMIN alone.
 *
 * These assert both halves, and both go red if the bar goes back to a fixed list.
 */
let customer: { role: string } | null = null;
let pathname = '/hq';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k }),
}));

import { HqBottomNav } from '@/components/hq/hq-bottom-nav';

const hrefs = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));

describe('HQ mobile navigation (CA-2-61)', () => {
  beforeEach(() => {
    customer = null;
    pathname = '/hq';
  });

  it('reaches every screen the role may open, not four of sixty-four', () => {
    customer = { role: 'SUPER_ADMIN' };
    const { container } = render(<HqBottomNav />);

    // The bar itself is still a bar — a handful of tabs, not a wall of links.
    expect(hrefs(container).length).toBeLessThan(6);

    fireEvent.click(screen.getByRole('button', { name: /hq\.nav\.more/ }));
    const drawer = screen.getByRole('dialog');
    const reachable = new Set(hrefs(drawer));
    const expected = hqItemsForRole('SUPER_ADMIN').map((i) => i.href);

    expect(expected.length).toBeGreaterThan(50);
    for (const href of expected) expect(reachable.has(href)).toBe(true);
  });

  /*
   * The dead tab. `/hq/access` is SUPER_ADMIN-only, so head office carried a permanent tab
   * to a refusal — and FINANCE, which does not hold `dashboard`, had `/hq` as its dead
   * FIRST tab. Offering a door the same model hides is the bug, in either direction.
   */
  it.each(['HEAD_OFFICE', 'DIREKTUR', 'FINANCE'])('offers %s no door it cannot open', (role) => {
    customer = { role };
    const { container, unmount } = render(<HqBottomNav />);

    const allowed = new Set(hqItemsForRole(role).map((i) => i.href));
    const offered = hrefs(container);
    expect(offered.length).toBeGreaterThan(0);
    for (const href of offered) expect(allowed.has(href!)).toBe(true);
    expect(offered).not.toContain('/hq/access');
    unmount();
  });

  it('carries the way out, which only the desktop rail used to have', () => {
    customer = { role: 'HEAD_OFFICE' };
    render(<HqBottomNav />);
    fireEvent.click(screen.getByRole('button', { name: /hq\.nav\.more/ }));
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: /signOut/i }),
    ).toBeTruthy();
  });

  it('renders nothing for a role outside the console', () => {
    customer = { role: 'STAFF_DEPOT' };
    const { container } = render(<HqBottomNav />);
    expect(container.innerHTML).toBe('');
  });
});
