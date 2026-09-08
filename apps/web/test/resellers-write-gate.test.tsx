// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-3-44 — /resellers offered its registration form to everyone who could read the screen.
 *
 * `resellerView` includes SUPERVISOR and HR. `resellerAdmin`, which `POST /resellers`
 * requires, does not. So both roles got a full form — phone, monthly target, discount, flat
 * price, join date — that ended in a 403 after they had typed all of it, and the only clue
 * was a generic failure message. The Import Excel button beside it was already gated on the
 * same capability; the form was the gap.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
// `assignedDepotId` is what a non-HQ role's depot comes from; without it the screen has
// no depot and renders no form for anyone, which would make these tests pass vacuously.
const auth = {
  customer: null as { id: string; role: string; assignedDepotId: string } | null,
};

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: auth.customer }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-1',
    ready: true,
    error: null,
    reload: vi.fn(),
    depots: [{ id: 'depot-1', name: 'Depot Utama' }],
    selected: { id: 'depot-1', name: 'Depot Utama' },
  }),
}));
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

import ResellersPage from '@/app/resellers/page';

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

/** The form's own field — present only when the form is. */
const formShown = () => document.querySelectorAll('form').length > 0;

describe('CA-3-44 the reseller registration form', () => {
  it('is not offered to SUPERVISOR, whose POST the server refuses', async () => {
    auth.customer = { assignedDepotId: 'depot-1', id: 'u1', role: 'SUPERVISOR' };
    render(<ResellersPage />);
    await waitFor(() => expect(screen.queryByText('hrFix.resellers.title')).toBeTruthy());
    expect(formShown()).toBe(false);
  });

  it('is not offered to HR either', async () => {
    auth.customer = { assignedDepotId: 'depot-1', id: 'u2', role: 'HR' };
    render(<ResellersPage />);
    await waitFor(() => expect(screen.queryByText('hrFix.resellers.title')).toBeTruthy());
    expect(formShown()).toBe(false);
  });

  it('is still there for a MANAGER, who holds resellerAdmin', async () => {
    auth.customer = { assignedDepotId: 'depot-1', id: 'u3', role: 'MANAGER' };
    render(<ResellersPage />);
    await waitFor(() => expect(formShown()).toBe(true));
  });

  it('still lets SUPERVISOR read the screen — the row was about writing, not looking', async () => {
    auth.customer = { assignedDepotId: 'depot-1', id: 'u4', role: 'SUPERVISOR' };
    render(<ResellersPage />);
    await waitFor(() => expect(screen.queryByText('hrFix.resellers.title')).toBeTruthy());
    expect(screen.queryByText('Akses ditolak')).toBeNull();
  });
});
