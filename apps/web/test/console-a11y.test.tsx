// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { ConfirmProvider } from '@/components/confirm';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-50 — the console's accessibility was never measured.
 *
 * `check-lighthouse.mjs` reaches four pages: `/`, `/products`, `/login`, `/driver`. Every
 * one of them is anonymous. The 132 console pages sit behind a session, so Lighthouse has
 * never seen a single one, and `check-a11y.mjs` scans SOURCE for four known shapes rather
 * than measuring what the browser is actually handed.
 *
 * This measures the rendered DOM with axe-core, which is the same engine Lighthouse uses.
 *
 * WHAT THIS CANNOT SEE, said plainly rather than left to be discovered: jsdom has no layout
 * and no paint, so every rule that needs geometry or computed colour is inert here —
 * colour-contrast above all, plus target-size and anything about overlap. Those still need
 * a real browser against a signed-in session, and that half of the row stays owed. What is
 * covered is the structural half: names, roles, labels, heading order, duplicate ids, list
 * and table structure — which is most of what a screen reader actually walks.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  getBlob: vi.fn(),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
  useLocale: () => ({ locale: 'id', setLocale: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' }],
    selected: { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
    selectedId: 'd-1',
    scopedId: 'd-1',
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

/**
 * Everything axe knows, minus the one rule jsdom cannot answer. `colour-contrast` needs a
 * painted pixel; without it axe reports every element as "incomplete", which is noise, not a
 * finding. Measured on the eleven screens below: with contrast off the full rule set is
 * quiet, so there is no reason to narrow it further and every reason not to — an allowlist
 * only measures the defects someone already thought of.
 */
const OFF = { 'color-contrast': { enabled: false } };

async function violationsOf(ui: React.ReactElement, expectRendered = true): Promise<string[]> {
  // Two of these screens correct a record, so their controls live behind the confirm
  // provider the console mounts around them.
  const { container } = render(<ConfirmProvider>{ui}</ConfirmProvider>);
  /*
   * A screen that failed to render has no violations either, and that is exactly how this
   * kind of test quietly stops measuring anything. Require some structure before believing
   * a clean result.
   */
  if (expectRendered) {
    // Every one of these screens loads through `useAsync`, and its first paint is a single
    // skeleton element. Measuring there would measure the skeleton, not the screen.
    await waitFor(() => expect(container.querySelectorAll('*').length).toBeGreaterThan(8));
  }
  const results = await axe.run(container, { rules: OFF, resultTypes: ['violations'] });
  return results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s) — ${v.help}`);
}

/*
 * Shapes, not a single catch-all. The first cut answered every call with one object and the
 * pages rendered their failure state instead of themselves — axe then measured a broken
 * screen and reported nothing, which is worse than not measuring at all. Each family of
 * endpoint gets what its caller actually destructures.
 */
function respond(raw: unknown) {
  const path = String(raw ?? '');
  // Ordered, because several of these overlap: a depot inventory read is
  // `/depots/.../inventory`, and answering it with the paged depot-list shape hands the
  // screen an object where it walks an array.
  const list: RegExp[] = [
    /incidents/, // depot inbox and the courier field list both answer with a bare array
    /\/inventory/,
    /stock-transfers/,
    /\/prices/,
    /\/drivers/,
    /\/staff/,
    /\/bonuses|\/deductions/,
    /\/withdrawals/,
    /\/sweeps/,
  ];
  if (list.some((re) => re.test(path))) return Promise.resolve([]);

  if (path.includes('/payout/summary'))
    return Promise.resolve({
      availableBalance: 0,
      monthRevenue: 0,
      monthCommission: 0,
      nextPayoutDate: '2026-09-25',
      recentEntries: [],
      recentWithdrawals: [],
    });

  if (path.includes('system-health'))
    return Promise.resolve({ services: [], upCount: 0, total: 0, checkedAt: '2026-09-09T00:00:00.000Z' });

  // The outbox gauge reads a bare count-per-status map.
  if (path.includes('outbox/pending')) return Promise.resolve({});

  if (path.includes('/dashboard') || path.includes('/analytics')) {
    return Promise.resolve({
      depotId: null,
      periodMonth: '2026-09',
      workDate: '2026-09-09',
      headcount: { total: 0, byStatus: [], byEmploymentStatus: [] },
      attendanceToday: [],
      payroll: {
        totals: { gross: 0, totalBonus: 0, totalDeduction: 0, net: 0, count: 0 },
        byStatus: [],
      },
      documentsExpiring: [],
      employmentsEnding: [],
    });
  }

  // Everything else in this set is a paged list.
  return Promise.resolve({ items: [], rows: [], total: 0, page: 1, limit: 20 });
}

beforeEach(() => {
  get.mockReset().mockImplementation(respond);
  post.mockReset().mockResolvedValue({});
});

describe('CA-2-50 the console is measured, not assumed', () => {
  /*
   * Eleven screens, one per family, rather than all 132: each one needs its own data shape
   * mocked, and a screen mocked wrongly renders its failure state — which has no violations
   * either. Breadth bought by measuring nothing is the failure this row already describes.
   */
  it.each([
    ['depot · insiden', () => import('@/app/dashboard/incidents/page')],
    ['depot · inventaris', () => import('@/app/dashboard/inventory/page')],
    ['depot · pesanan', () => import('@/app/dashboard/orders/page')],
    ['depot · payout', () => import('@/app/dashboard/payout/page')],
    ['HQ · pesanan', () => import('@/app/hq/orders/page')],
    ['HQ · kesehatan', () => import('@/app/hq/health/page')],
    ['HQ · staf', () => import('@/app/hq/staff/page')],
    ['HR · beranda', () => import('@/app/hr/page')],
    ['HR · absensi', () => import('@/app/hr/attendance/page')],
    ['HR · cuti', () => import('@/app/hr/leave/page')],
    ['HR · penyesuaian', () => import('@/app/hr/adjustments/page')],
  ])('%s has no structural barrier a screen reader would hit', async (_name, load) => {
    const { default: Page } = await load();
    expect(await violationsOf(<Page />)).toEqual([]);
  });

  /*
   * The gate has to be able to fail, or it is a green tick over an unmeasured console. A
   * button whose only content is an icon has no accessible name, and axe must say so.
   */
  it('reports a control a screen reader cannot name', async () => {
    const found = await violationsOf(
      <button type="button">
        <svg aria-hidden="true" />
      </button>,
      false,
    );
    expect(found.join(' ')).toContain('button-name');
  });
});
