// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { path, auth } = vi.hoisted(() => ({
  path: { current: '/dashboard/insight' },
  auth: { customer: { id: 'u1', role: 'KEPALA_DEPOT', fullName: 'Kepala' } },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ selected: { id: 'd1', name: 'Depot Satu' }, depots: [] }),
}));
vi.mock('@/lib/ops-notifications', () => ({ useOpsNotifications: () => ({ unreadCount: 0 }) }));

import { OperatorShell } from '@/components/operator/operator-shell';
import { useWallScreen } from '@/lib/insight/wall-screen';
import { LocaleProvider } from '@/lib/locale-context';

function Probe() {
  return <p>{useWallScreen() ? 'wall' : 'normal'}</p>;
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('the wall-screen flag', () => {
  it('steps the console frame aside on the dashboard, and only there', () => {
    path.current = '/dashboard/insight';
    window.history.replaceState(null, '', '/dashboard/insight?tv=1');
    render(<Probe />);
    expect(screen.getByText('wall')).toBeTruthy();
  });

  it('ignores the flag on any other page, and a different value', () => {
    path.current = '/dashboard/orders';
    window.history.replaceState(null, '', '/dashboard/orders?tv=1');
    const { unmount } = render(<Probe />);
    expect(screen.getByText('normal')).toBeTruthy();
    unmount();
    path.current = '/dashboard/insight';
    window.history.replaceState(null, '', '/dashboard/insight?tv=0');
    render(<Probe />);
    expect(screen.getByText('normal')).toBeTruthy();
  });
});

describe('the depot head’s console', () => {
  it('has a way into the dashboard', () => {
    path.current = '/dashboard';
    render(
      <LocaleProvider>
        <OperatorShell>
          <p>isi</p>
        </OperatorShell>
      </LocaleProvider>,
    );
    const link = screen.getByRole('link', { name: 'Dasbor' });
    expect(link.getAttribute('href')).toBe('/dashboard/insight');
  });
});
