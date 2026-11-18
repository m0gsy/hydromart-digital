// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-3d of the flow plan: twin routes merged. /dashboard/profile and
 * /dashboard/operator-settings are /dashboard/account now; /dashboard/depot-settings is the
 * read view at the top of /dashboard/settings. The old routes stay alive as redirects.
 */
const { replace, signOut, who } = vi.hoisted(() => ({
  replace: vi.fn(),
  signOut: vi.fn(),
  who: { role: 'MANAGER' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/account',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', role: who.role, fullName: 'Uji Coba', phone: '0811' },
    ready: true,
    signOut,
  }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd1', name: 'Depot Satu', code: 'D1' }],
    selected: { id: 'd1', name: 'Depot Satu', code: 'D1' },
    scopedId: 'd1',
    ready: true,
  }),
}));
vi.mock('@/lib/notif-prefs', () => ({
  usePushPrefs: () => ({ isOn: () => null, setOn: vi.fn() }),
}));
vi.mock('@/components/dashboard/ops-push', () => ({ DevicePushRow: () => null }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-effective-capabilities', () => ({
  useEffectiveCapabilities: () => ({ dashboard: ['MANAGER'], hqConsole: ['HEAD_OFFICE'] }),
}));
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    getCached: vi.fn().mockResolvedValue({
      id: 'd1',
      name: 'Depot Satu',
      serviceRadiusKm: 5,
      operatingHours: null,
    }),
  },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/settings', () => ({
  fetchSettingsSchema: vi.fn().mockResolvedValue({ effective: {} }),
}));

import AccountPage from '@/app/dashboard/account/page';
import DepotSettingsPage from '@/app/dashboard/depot-settings/page';
import OperatorSettingsPage from '@/app/dashboard/operator-settings/page';
import ProfilePage from '@/app/dashboard/profile/page';
import { DepotSettingsSummary } from '@/components/dashboard/depot-settings-summary';

afterEach(() => vi.clearAllMocks());

describe('the old routes redirect', () => {
  it.each([
    ['/dashboard/profile', ProfilePage, '/dashboard/account'],
    ['/dashboard/operator-settings', OperatorSettingsPage, '/dashboard/account'],
    ['/dashboard/depot-settings', DepotSettingsPage, '/dashboard/settings?mode=read'],
  ])('%s goes to its twin', (_from, Page, to) => {
    render(<Page />);
    expect(replace).toHaveBeenCalledWith(to);
  });
});

describe('the merged account screen', () => {
  it('a manager sees who they are, their depot and their access, as on the profile', () => {
    who.role = 'MANAGER';
    render(<AccountPage />);
    expect(screen.getByText('Uji Coba')).toBeTruthy();
    expect(screen.getByText('Depot Satu · D1')).toBeTruthy();
    expect(screen.getByText('dashboard')).toBeTruthy();
    // the head of depot's own alerts are not theirs
    expect(screen.queryByText('dashB.operatorSettings.notifNewOrder')).toBeNull();
  });

  it("the head of depot gets the operator screen's alerts, and no capability list", () => {
    who.role = 'KEPALA_DEPOT';
    render(<AccountPage />);
    expect(screen.getByText('dashB.operatorSettings.notifNewOrder')).toBeTruthy();
    expect(screen.getByText('dashB.operatorSettings.notifCourierFail')).toBeTruthy();
    expect(screen.queryByText('dashC.profile.access')).toBeNull();
  });

  it('names an assigned depot only for a role that runs one', () => {
    who.role = 'HEAD_OFFICE';
    render(<AccountPage />);
    expect(screen.queryByText('dashC.profile.depotAssigned')).toBeNull();
  });

  it('keeps the way out the merged screens had', () => {
    who.role = 'KEPALA_DEPOT';
    render(<AccountPage />);
    fireEvent.click(screen.getByText('dashC.profile.signOut'));
    expect(signOut).toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
  });
});

describe('settings carries the depot read view', () => {
  it('shows the four figures the old screen read', async () => {
    render(<DepotSettingsSummary />);
    expect(screen.getByText('mgrFix.depotSettings.title')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('mgrFix.depotSettings.radius')).toBeTruthy());
    expect(screen.getByText('mgrFix.depotSettings.concurrency')).toBeTruthy();
  });

  it('is on the settings page itself', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(process.cwd(), 'src/app/dashboard/settings/page.tsx'),
      'utf8',
    );
    // its read mode, not a strip above the forms (it went stale there on every save)
    expect(src).toContain("useQueryParam('mode') === 'read'");
    expect(src).toContain('<DepotSettingsSummary />');
  });
});
