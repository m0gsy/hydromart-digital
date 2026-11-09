// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { CashierShiftBar } from '@/components/dashboard/cashier-shift-bar';
import { LocaleProvider } from '@/lib/locale-context';

const shift = (over: Record<string, unknown> = {}) => ({
  id: 's-2',
  depotId: 'd-1',
  cashierId: 'c-1',
  cashierName: '0812',
  status: 'OPEN',
  openingFloat: 200000,
  openedAt: '2026-11-09T01:00:00.000Z',
  closedAt: null,
  countedCash: null,
  expectedCash: null,
  variance: null,
  note: null,
  liabilityIdr: null,
  ...over,
});

const draw = () =>
  render(
    <LocaleProvider>
      <CashierShiftBar depotId="d-1" />
    </LocaleProvider>,
  );

beforeEach(() => post.mockReset());
afterEach(() => vi.clearAllMocks());

describe('CashierShiftBar · liability from a rejected shortfall (DEP-05)', () => {
  it('tells the cashier what they still owe from an earlier shift', async () => {
    get.mockReset().mockResolvedValue(shift({ carriedLiabilityIdr: 50000 }));
    draw();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/50\.000/);
    expect(alert.textContent).toMatch(/tanggungan/i);
  });

  it('says nothing when nothing is owed', async () => {
    get.mockReset().mockResolvedValue(shift({ carriedLiabilityIdr: 0 }));
    draw();
    await screen.findByTestId('cashier-shift-open');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
