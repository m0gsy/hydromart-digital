// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three HR screens that showed a conclusion and hid what it was made of.
 *
 *  - CA-1-37: the departments screen could create, deactivate and DELETE a department, and
 *    offered no way to see who was in one — so "hapus" was a decision taken without the one
 *    fact that decides it. `/hr/employees` has read `?departmentId=` since CA-1-35.
 *  - CA-1-65: a performance row showed one score and hid the three it is made of. Worse,
 *    the distinction the type itself documents was invisible: `null` means the component
 *    had NOTHING TO MEASURE, which is not the same as scoring zero.
 *  - CA-1-67: the announcement history printed the target DIMENSION and never the value —
 *    "Depot, Departemen", on the screen whose whole job is saying who was told what.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'dep-1', code: 'JKT-01', name: 'Depot Cikini' }],
    scopedId: null,
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock('@/lib/use-query-param', () => ({
  useQueryParam: () => null,
  useQueryState: () => ['', vi.fn()],
}));

import DepartmentsPage from '@/app/hr/departments/page';
import AnnouncementsPage from '@/app/hr/announcements/page';

const DEPARTMENTS = [{ id: 'd-9', code: 'OPS', name: 'Operasional', depotId: 'dep-1', active: true }];

beforeEach(() => {
  get.mockReset().mockImplementation(async (u: string) => {
    if (String(u).includes('/departments')) return DEPARTMENTS;
    if (String(u).includes('/announcements'))
      return {
        rows: [
          {
            id: 'a-1',
            title: 'Libur',
            body: 'x',
            level: 'INFO',
            publishedAt: '2026-09-01T02:00:00.000Z',
            scheduledAt: null,
            audienceSize: 12,
            targets: [
              { dimension: 'DEPOT', value: 'dep-1' },
              { dimension: 'DEPARTMENT', value: 'd-9' },
              { dimension: 'COMPANY', value: null },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

describe('CA-1-37 a department leads to the people in it', () => {
  it('links each department to the employee list already filtered to it', async () => {
    render(<DepartmentsPage />);
    const link = await screen.findByRole('link', { name: /OPS/ });
    // The destination has read this parameter since CA-1-35; nothing pointed at it.
    expect(link.getAttribute('href')).toBe('/hr/employees?departmentId=d-9');
  });
});

describe('CA-1-67 the history says WHICH depot, not just "Depot"', () => {
  it('names the target beside its dimension', async () => {
    render(<AnnouncementsPage />);
    // "Depot" alone is not an audience.
    await waitFor(() =>
      expect(screen.getByText(/hrFix\.map\.announceDim\.DEPOT: JKT-01/)).toBeTruthy(),
    );
    expect(screen.getByText(/hrFix\.map\.announceDim\.DEPARTMENT: Operasional/)).toBeTruthy();
  });

  it('leaves a company-wide target as the bare dimension — it has no value to name', async () => {
    render(<AnnouncementsPage />);
    await waitFor(() => expect(screen.getByText(/announceDim\.COMPANY/)).toBeTruthy());
    expect(screen.queryByText(/announceDim\.COMPANY:/)).toBeNull();
  });
});

describe('CA-1-65 a performance score shows its parts', () => {
  it('renders the three components, and distinguishes not-measured from zero', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/hr/performance/page.tsx', 'utf8').replace(
      /\{\/\*[\s\S]*?\*\/\}/g,
      '',
    );

    // The row used to show `r.score` alone: a conclusion that could be accepted but not
    // questioned.
    for (const part of ['attendanceScore', 'disciplineScore', 'salesScore']) {
      expect(src).toContain(`r.${part} ?? '—'`);
    }
    // `?? '—'`, never `?? 0`. The type says null means the component had NOTHING to measure
    // that period; a zero would claim it was measured and bad.
    expect(src).not.toMatch(/r\.(attendance|discipline|sales)Score \?\? 0/);
  });
});
