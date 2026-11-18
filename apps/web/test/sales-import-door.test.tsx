// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Owner decision 2026-11-18: the pre-Hydromart sales import gets its door on head office's
 * report export, the screen where that history is read (top depots, revenue by product),
 * for the roles that hold `salesImportAdmin` and reach /hq. (The import was already depot-scoped
 * by order-service's global DepotScopeGuard.)
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const who = { role: 'HEAD_OFFICE' };

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn() },
  ApiError: class extends Error {},
  postBlob: vi.fn(),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/reports/export',
  useSearchParams: () => new URLSearchParams(),
}));

// The figures are not under test: every read stays loading.
vi.mock('@/lib/use-async', () => ({
  useAsync: () => ({ data: null, loading: true, error: null, reload: vi.fn() }),
}));

import ReportsExportPage from '@/app/hq/reports/export/page';

beforeEach(() => {
  who.role = 'HEAD_OFFICE';
  get.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('the sales-history import door', () => {
  it('is on the HQ report export for a role that may import', async () => {
    render(<ReportsExportPage />);
    await waitFor(() => expect(screen.getByText('hrFix.imports.salesHistory')).toBeTruthy());
    expect(screen.getByText('hrFix.imports.salesHistory').closest('a')?.getAttribute('href')).toBe(
      '/dashboard/sales-import',
    );
  });

  it('is not offered to FINANCE, which reads the export but may not import', () => {
    who.role = 'FINANCE';
    render(<ReportsExportPage />);
    expect(screen.queryByText('hrFix.imports.salesHistory')).toBeNull();
  });
});
