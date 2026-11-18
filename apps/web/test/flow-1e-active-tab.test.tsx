// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-1e of the flow plan. The APK export runs with `trailingSlash: true`, and Next derives
 * `usePathname()` from the canonical URL as is — so on a phone the courier home is `/driver/`,
 * and every nav that compared `pathname === '/driver'` left its home tab dark. Each nav below
 * is rendered at the slash-ended path the APK hands it; its home link must still be current.
 */
const who = { role: 'MANAGER', path: '/' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => who.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, fullName: 'Uji', phone: '0811' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/lib/depot-context', () => ({
  DepotProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDepot: () => ({
    depots: [],
    selected: null,
    selectedId: null,
    scopedId: null,
    ready: true,
    setSelected: vi.fn(),
  }),
}));
vi.mock('@/lib/unread', () => ({ useUnreadCount: () => 0, useOpsUnreadCount: () => 0 }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <div data-testid="auth-wall">{children}</div>,
}));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: async () => true }) }));
vi.mock('@/lib/theme-context', () => ({
  useTheme: () => ({ theme: 'light', resolved: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/lib/ops-notifications', () => ({ useOpsNotifications: () => ({ unreadCount: 0 }) }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue([]), getCached: vi.fn().mockResolvedValue([]) },
  ApiError: class extends Error {},
}));

import { DriverShell } from '@/components/driver/driver-shell';
import { HqBottomNav } from '@/components/hq/hq-bottom-nav';
import { HqRail } from '@/components/hq/hq-rail';
import { HrBottomNav } from '@/components/hr/hr-bottom-nav';
import { HrRail } from '@/components/hr/hr-rail';
import { ManagerShell } from '@/components/manager-mobile/manager-shell';
import { OpsBottomNav } from '@/components/dashboard/ops-bottom-nav';
import { OpsRail } from '@/components/dashboard/ops-rail';
import { OperatorShell } from '@/components/operator/operator-shell';
import ManagerMobileLayout from '@/app/m/manager/layout';

afterEach(() => vi.clearAllMocks());

const current = (href: string) => document.querySelector(`a[href="${href}"][aria-current="page"]`);

const CASES: Array<[name: string, role: string, path: string, home: string, ui: () => React.ReactElement]> = [
  ['courier shell', 'STAFF_DEPOT', '/driver/', '/driver', () => <DriverShell>x</DriverShell>],
  ['HQ phone bar', 'HEAD_OFFICE', '/hq/', '/hq', () => <HqBottomNav />],
  ['HQ rail', 'HEAD_OFFICE', '/hq/', '/hq', () => <HqRail />],
  ['HR phone bar', 'HR', '/hr/', '/hr', () => <HrBottomNav />],
  ['HR rail', 'HR', '/hr/', '/hr', () => <HrRail />],
  ['manager phone shell', 'MANAGER', '/m/manager/', '/m/manager', () => <ManagerShell nav>x</ManagerShell>],
  ['ops phone bar', 'MANAGER', '/dashboard/', '/dashboard', () => <OpsBottomNav />],
  ['ops rail', 'MANAGER', '/dashboard/', '/dashboard', () => <OpsRail />],
  ['operator shell', 'KEPALA_DEPOT', '/dashboard/', '/dashboard', () => <OperatorShell>x</OperatorShell>],
];

describe('the home tab is current at the path the APK hands over', () => {
  it.each(CASES)('%s at %s', (_name, role, path, home, ui) => {
    who.role = role;
    who.path = path;
    render(ui());
    expect(current(home)).toBeTruthy();
  });
});

describe('the manager phone layout reads the APK path too', () => {
  it('serves its OTP login bare at /m/manager/login/, outside the sign-in wall', () => {
    who.role = 'MANAGER';
    who.path = '/m/manager/login/';
    const { queryByTestId, getByText } = render(<ManagerMobileLayout>login</ManagerMobileLayout>);
    expect(getByText('login')).toBeTruthy();
    expect(queryByTestId('auth-wall')).toBeNull();
  });
});
