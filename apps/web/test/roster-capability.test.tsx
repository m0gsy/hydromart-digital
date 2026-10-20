// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Production, 2026-10-20 22:03:25 and :45 — `GET /auth/drivers?depotId=…` answered 403
 * "You do not have permission to perform this action." to a depot courier's account, twice, with
 * a Ops 1.14.0 build. The request came from a screen the role may open (the order detail, the
 * order queue) asking for a list the role is not granted (`driverRosterRead`), and the 403 was
 * drawn as a failed panel that no retry could clear.
 *
 * The rule pinned here: a screen never asks for the courier roster on behalf of a role that
 * does not hold `driverRosterRead`. The server stays the authority; this stops the question
 * from being asked of it.
 */
const { get, role } = vi.hoisted(() => ({
  get: vi.fn(),
  role: { current: 'STAFF_DEPOT' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current } }),
}));

import { ConfirmProvider } from '@/components/confirm';
import { OrderDetail } from '@/components/dashboard/order-detail';
import { ToastProvider } from '@/components/toast';
import { canReadRoster } from '@/lib/drivers-scope';
import { LocaleProvider } from '@/lib/locale-context';

const ORDER = {
  id: 'ord-1',
  orderNumber: 'HM-0001',
  status: 'PREPARING',
  depotId: 'depot-a',
  recipientName: 'Ani',
  phone: '0899',
  deliveryAddress: 'Jl. Satu',
  items: [],
  history: [],
  subtotal: 0,
  deliveryFee: 0,
  discount: 0,
  total: 0,
  createdAt: '2026-08-04T02:00:00.000Z',
} as never;

const renderDetail = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <ConfirmProvider>
          <OrderDetail order={ORDER} onClose={() => {}} onChanged={() => {}} />
        </ConfirmProvider>
      </ToastProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path: string) =>
    Promise.resolve(path.includes('/auth/drivers') || path.includes('/shifts') ? [] : { items: [] }),
  );
});
afterEach(() => vi.clearAllMocks());

describe('canReadRoster mirrors the server capability', () => {
  it.each([
    'KEPALA_DEPOT',
    'SUPERVISOR',
    'ASSISTANT_SUPERVISOR',
    'MANAGER',
    'HEAD_OFFICE',
    'DIREKTUR',
    'FINANCE',
    'SUPER_ADMIN',
  ])(
    '%s may read the courier list',
    (r) => expect(canReadRoster(r)).toBe(true),
  );

  it.each([
    'STAFF_DEPOT',
    'HR',
    'MARKETING',
    'FRANCHISE_OWNER',
    'CUSTOMER',
    undefined,
    null,
  ])('%s may not', (r) => expect(canReadRoster(r)).toBe(false));
});

describe('the order detail never asks for a roster the role is not granted', () => {
  it('a depot courier opening a PREPARING order makes no /auth/drivers request', async () => {
    role.current = 'STAFF_DEPOT';
    renderDetail();

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.some(([p]) => String(p).includes('/auth/drivers'))).toBe(false);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  // Owner decision 2026-10-20: the two supervisor roles dispatch, so they get the list.
  it.each(['SUPERVISOR', 'ASSISTANT_SUPERVISOR'])('a %s still gets the roster to pick from', async (r) => {
    role.current = r;
    renderDetail();

    await waitFor(() =>
      expect(get.mock.calls.some(([p]) => String(p).includes('/auth/drivers'))).toBe(true),
    );
  });

  it('the depot head still gets the roster and the picker', async () => {
    role.current = 'KEPALA_DEPOT';
    renderDetail();

    await waitFor(() =>
      expect(get.mock.calls.some(([p]) => String(p).includes('/auth/drivers'))).toBe(true),
    );
  });
});
