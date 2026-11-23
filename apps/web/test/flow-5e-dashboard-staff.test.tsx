// @vitest-environment jsdom
/**
 * Flow plan 5e: /dashboard/staff renders the /hq/staff directory. Head office on the phone
 * (the Ops app carries /dashboard and not /hq) had a read-only list there; now it has each
 * account's depot, status, HR record and the row controls, as on the web console.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, who } = vi.hoisted(() => ({ get: vi.fn(), who: { role: 'SUPER_ADMIN' } }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// The directory's reset-authenticator row control (AI-3a) reports through the toast.
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/lib/use-custom-roles', () => ({
  useCustomRoles: () => [],
  useDisabledRoles: () => new Set<string>(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/staff',
  useSearchParams: () => new URLSearchParams(),
}));

const courier = {
  id: 'acc-1',
  fullName: 'Budi Kurir',
  phone: '81200000001',
  role: 'STAFF_DEPOT',
  status: 'ACTIVE',
  assignedDepotId: 'd1',
};

beforeEach(() => {
  who.role = 'SUPER_ADMIN';
  get.mockReset().mockImplementation((url: string) => {
    if (url.includes('/staff')) return Promise.resolve({ items: [courier], total: 1, page: 1, limit: 100 });
    if (url.includes('/depots/manage')) return Promise.resolve({ items: [{ id: 'd1', name: 'BKS Galaxy' }], total: 1 });
    // HR has no employee record behind the account: the badge's case.
    if (url.includes('/employees')) return Promise.resolve({ rows: [], total: 0 });
    return Promise.resolve({ items: [], total: 0 });
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function drawDepotPage() {
  const { default: Page } = await import('@/app/dashboard/staff/page');
  render(<Page />);
  await screen.findByText('Budi Kurir');
}

describe('/dashboard/staff is the head-office directory', () => {
  it("carries the row controls /hq/staff has: the account's depot, status, delete, and the role chips", async () => {
    await drawDepotPage();
    expect(screen.getByRole('combobox', { name: 'hq.staff.depot' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'hq.staff.deactivate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'hq.staff.delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'hq.staff.filterAll' }).getAttribute('aria-pressed')).toBe('true');
    // What the depot page had of its own stays: the access matrix and the invite.
    expect(screen.getByRole('button', { name: /dashC\.staff\.matrixTitle/ })).toBeTruthy();
  });

  it('on the web, the missing HR record is a door to the employee form', async () => {
    await drawDepotPage();
    const badge = await screen.findByText('hq.staff.noEmployeeRecord');
    expect(badge.closest('a')?.getAttribute('href')).toMatch(/^\/hr\/employees\/new\?/);
    // The import wizard too, as /hq/staff has it.
    expect(screen.getByRole('link', { name: 'hq.nav.staffImport' }).getAttribute('href')).toBe(
      '/hq/staff/import',
    );
  });

  it('in the Ops app, which does not carry that form, the badge says what is missing without a dead door', async () => {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', '/hq/*,/hr,/hr/employees/*,/hr/payroll/*');
    vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', 'dashboard,driver,hr,m,resellers,login,products');
    vi.resetModules();
    await drawDepotPage();
    const badge = await screen.findByText('hq.staff.noEmployeeRecord');
    expect(badge.closest('a')).toBeNull();
    // Nor a door to the import wizard, which lives under /hq.
    expect(screen.queryByRole('link', { name: 'hq.nav.staffImport' })).toBeNull();
  });
});

describe('/hq/staff', () => {
  it('does not ask a role that cannot move an account for the depot list', async () => {
    who.role = 'DIREKTUR';
    const { default: Page } = await import('@/app/hq/staff/page');
    render(<Page />);
    await screen.findByText('Budi Kurir');
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.map(([u]) => String(u)).some((u) => u.includes('/depots/manage'))).toBe(false);
    expect(screen.queryByRole('combobox', { name: 'hq.staff.depot' })).toBeNull();
  });
});
