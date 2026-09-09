// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-49 — the gate rule that threw away findings on a mixed line.
 *
 * `check-i18n.mjs` suppressed any string whose recorded line mentioned `t(`. A JSX text
 * node's recorded line is the tag it STARTS on, so a translated `title=` prop suppressed
 * the untranslated sentence in that tag's children:
 *
 *     <CenterState title={t('hrFix.expenseClaims.empty')}>
 *       Belum ada klaim {status.toLowerCase()}.
 *
 * The sentence was real, and lowercasing an enum into it is how it got written: the three
 * statuses on this screen were the enum itself, in the picker, on every badge, and there.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], scopedId: 'd1', ready: true, error: null, reload: vi.fn() }),
}));

import ExpenseClaimsPage from '@/app/dashboard/expense-claims/page';

beforeEach(() => get.mockReset());

describe('CA-2-49 the claims screen says the status in words', () => {
  it('names the filter in the empty line instead of lowercasing the enum', async () => {
    get.mockResolvedValue({ items: [], total: 0 });
    render(<ExpenseClaimsPage />);

    await waitFor(() =>
      expect(
        screen.getByText('hrFix.expenseClaims.emptyFor:hrFix.expenseClaims.statusPending'),
      ).toBeTruthy(),
    );
    // The enum itself never reaches the screen, in any case.
    expect(screen.queryByText(/\bpending\b/i)).toBeNull();
  });

  it('puts a word on the badge, not the enum', async () => {
    get.mockResolvedValue({
      items: [
        {
          id: 'c1',
          status: 'APPROVED',
          category: 'FUEL',
          amount: 50_000,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    render(<ExpenseClaimsPage />);

    await waitFor(() =>
      expect(screen.getByText('hrFix.expenseClaims.statusApproved')).toBeTruthy(),
    );
    expect(screen.queryByText('APPROVED')).toBeNull();
  });
});
