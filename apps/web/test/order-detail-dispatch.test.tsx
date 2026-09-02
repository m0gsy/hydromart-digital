// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, post } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'kd-1', role: 'KEPALA_DEPOT' } }),
}));

import { OrderDetail } from '@/components/dashboard/order-detail';
import { ConfirmProvider } from '@/components/confirm';
import { LocaleProvider } from '@/lib/locale-context';

const DRIVERS = [
  { id: 'drv-1', fullName: 'Budi', phone: '0811', role: 'STAFF_DEPOT', status: 'ACTIVE' },
  { id: 'drv-2', fullName: 'Sari', phone: '0812', role: 'STAFF_DEPOT', status: 'ACTIVE' },
];

/** A PREPARING order is the one state that shows the courier picker. */
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

/** Route each read by the path the component asks for, so order does not matter. */
function routeReads(shifts: () => Promise<unknown>) {
  get.mockImplementation((path: string) => {
    if (path.includes('/auth/drivers')) return Promise.resolve(DRIVERS);
    if (path.includes('/shifts')) return shifts();
    if (path.includes('/payments')) return Promise.resolve({ items: [] });
    return Promise.resolve({ items: [] });
  });
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

/*
 * C-1. The shift read is fail-soft on purpose: delivery-service has the final say, so a blip
 * must not stop dispatch. It caught to `[]`, which is a real answer meaning "nobody is on
 * shift" — so one transient 5xx disabled every courier and labelled them all "belum buka
 * shift". The guard reads `shifts != null`, so the catch has to produce null.
 */
// The component reads copy through useT(), which needs the provider — rendering it bare
// throws before a single assertion runs.
const renderDetail = () =>
  render(
    <LocaleProvider>
        <ConfirmProvider>
          <OrderDetail order={ORDER} onClose={() => {}} onChanged={() => {}} />
        </ConfirmProvider>
      </LocaleProvider>,
  );

describe('OrderDetail courier assignment when the shift view fails', () => {
  it('leaves every courier selectable when the shift read is rejected', async () => {
    routeReads(() => Promise.reject(new Error('503')));
    renderDetail();

    const budi = (await screen.findByRole('option', { name: /Budi/ })) as HTMLOptionElement;
    const sari = (await screen.findByRole('option', { name: /Sari/ })) as HTMLOptionElement;
    expect(budi.disabled).toBe(false);
    expect(sari.disabled).toBe(false);
    expect(budi.textContent).not.toContain('belum buka shift');
  });

  // The other half: a real empty answer still means nobody may be dispatched. Without this
  // the fix above could have been "never disable anything", which is a different bug.
  it('still disables a courier when the service really says nobody is on shift', async () => {
    routeReads(() => Promise.resolve([]));
    renderDetail();

    await waitFor(async () => {
      const budi = (await screen.findByRole('option', { name: /Budi/ })) as HTMLOptionElement;
      expect(budi.disabled).toBe(true);
    });
  });

  it('disables only the couriers who are actually off shift', async () => {
    routeReads(() =>
      Promise.resolve([
        { driverId: 'drv-1', depotId: 'depot-a', status: 'ONLINE', acceptsAssignments: true },
      ]),
    );
    renderDetail();

    const budi = (await screen.findByRole('option', { name: /Budi/ })) as HTMLOptionElement;
    const sari = (await screen.findByRole('option', { name: /Sari/ })) as HTMLOptionElement;
    expect(budi.disabled).toBe(false);
    expect(sari.disabled).toBe(true);
  });
});
