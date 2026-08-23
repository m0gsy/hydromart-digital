// @vitest-environment jsdom
/*
 * J10 — the agen (reseller) registry has no way in for the role that owns it. A depot
 * manager holds `resellerView`, and `/resellers` is linked from the HQ rail only — a rail
 * a manager never sees. The screen has been reachable by typing the URL, which is the same
 * as not existing.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const role = vi.hoisted(() => ({ current: 'MANAGER' }));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current, fullName: 'A' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'd-1',
    selectedId: 'd-1',
    selected: { id: 'd-1', name: 'Depot A', code: 'A' },
    depots: [{ id: 'd-1', name: 'Depot A', code: 'A' }],
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ items: [], total: 0 }), getCached: vi.fn().mockResolvedValue([]), post: vi.fn() },
  ApiError: class extends Error {},
}));

import { LocaleProvider } from '@/lib/locale-context';
import { OpsRail } from '@/components/dashboard/ops-rail';

const hrefs = () => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));

beforeEach(() => {
  role.current = 'MANAGER';
});
afterEach(() => vi.clearAllMocks());

describe('J10 · the agen registry has a door', () => {
  it('a depot manager finds /resellers in their own rail', () => {
    render(<OpsRail />, { wrapper: LocaleProvider });
    expect(hrefs()).toContain('/resellers');
  });

  it('a courier does not', () => {
    role.current = 'STAFF_DEPOT';
    render(<OpsRail />, { wrapper: LocaleProvider });
    expect(hrefs()).not.toContain('/resellers');
  });
});
