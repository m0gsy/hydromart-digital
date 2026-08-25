// @vitest-environment jsdom
/*
 * K1.9 — a plan was locked to whichever address happened to be primary when it was made:
 * no picker at signup, no way to change it afterwards, and switching your primary address
 * did not move it. Somebody who moved house could only cancel and start again.
 *
 * K1.10 — a subscription discount that could not be READ rendered exactly like a depot
 * that gives none. Two of the three states behind that silence are wrong, and the wrong
 * one costs the customer the reason they are on this screen.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), getCached: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: apiMock, ApiError: class extends Error {} }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/subscriptions',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import SubscriptionsPage from '@/app/subscriptions/page';

const HOME = {
  id: 'a-home',
  label: 'Rumah',
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
  postalCode: '40111',
  latitude: -6.9,
  longitude: 107.6,
  isPrimary: true,
};
const OFFICE = { ...HOME, id: 'a-office', label: 'Kantor', addressLine: 'Jl. Asia Afrika 55', isPrimary: false };

const PLAN = {
  id: 's-1',
  customerId: 'c-1',
  productId: 'p-1',
  productName: 'Galon 19L',
  unit: 'galon',
  quantity: 2,
  frequency: 'WEEKLY',
  status: 'ACTIVE',
  nextDeliveryAt: '2026-09-01T00:00:00.000Z',
  latitude: -6.9,
  longitude: 107.6,
  addressLine: 'Jl. Merdeka 10',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/** Routes each `api.get` by URL so the page can be rendered whole. */
function route(over: { discountFails?: boolean; subs?: unknown[] } = {}) {
  apiMock.get.mockImplementation((url: string) => {
    if (url.includes('/subscriptions/discount')) {
      return over.discountFails ? Promise.reject(new Error('down')) : Promise.resolve({ rate: 0.1 });
    }
    if (url.includes('/addresses')) return Promise.resolve([HOME, OFFICE]);
    if (url.includes('/subscriptions')) return Promise.resolve(over.subs ?? []);
    if (url.includes('/depots/nearby')) return Promise.resolve([{ id: 'd-1' }]);
    if (url.includes('/products')) {
      return Promise.resolve({ items: [{ id: 'p-1', name: 'Galon 19L', unit: 'galon', basePrice: 20000 }], total: 1 });
    }
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  route();
});
afterEach(() => vi.clearAllMocks());

const renderPage = () => render(<SubscriptionsPage />, { wrapper: LocaleProvider });

describe('K1.9 · a subscription is no longer locked to the primary address', () => {
  it('offers every saved address at signup, defaulting to the primary one', async () => {
    renderPage();

    const picker = (await screen.findByLabelText(/antar ke|deliver to/i)) as HTMLSelectElement;
    expect(picker.value).toBe('a-home');
    expect([...picker.options].map((o) => o.value)).toEqual(['a-home', 'a-office']);
  });

  it('creates the plan against the address that was PICKED, not the primary one', async () => {
    apiMock.post.mockResolvedValue(PLAN);
    renderPage();

    const picker = await screen.findByLabelText(/antar ke|deliver to/i);
    fireEvent.change(picker, { target: { value: 'a-office' } });
    fireEvent.change(await screen.findByLabelText(/produk|product/i), { target: { value: 'p-1' } });
    fireEvent.click(screen.getByRole('button', { name: /mulai langganan|start a subscription/i }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    const body = apiMock.post.mock.calls[0]![1] as { deliveryAddress: { addressLine: string } };
    expect(body.deliveryAddress.addressLine).toBe('Jl. Asia Afrika 55');
  });

  it('moves an existing plan to another address, with the plan own line named first', async () => {
    route({ subs: [PLAN] });
    apiMock.post.mockResolvedValue({ ...PLAN, addressLine: 'Jl. Asia Afrika 55' });
    renderPage();

    const rowPicker = (await screen.findByLabelText(/antar ke|deliver to/i, {
      selector: '#sub-addr-s-1',
    })) as HTMLSelectElement;
    // The plan holds a SNAPSHOT: the address book entry behind it can have been edited or
    // deleted since, so the line itself is always an option.
    expect([...rowPicker.options].map((o) => o.textContent)).toContain('Jl. Merdeka 10');

    fireEvent.change(rowPicker, { target: { value: 'a-office' } });

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/orders/api/v1/subscriptions/s-1/address',
        expect.objectContaining({
          deliveryAddress: expect.objectContaining({ addressLine: 'Jl. Asia Afrika 55' }),
        }),
        true,
      ),
    );
  });

  it('says out loud that the plan keeps its own address', async () => {
    renderPage();

    expect(
      await screen.findByText(/menyimpan alamatnya sendiri|keeps its own address/i),
    ).toBeTruthy();
  });
});

describe('K1.10 · a discount that could not be read', () => {
  it('quotes the saving when it IS known', async () => {
    renderPage();

    expect(await screen.findByText(/hemat 10%|save 10%/i)).toBeTruthy();
  });

  /*
   * The whole point. Before, a failed read fell through `?? 0` and the banner simply was
   * not there — byte for byte what a depot that gives no discount looks like.
   */
  it('says the read failed instead of implying there is no discount', async () => {
    route({ discountFails: true });
    renderPage();

    expect(
      await screen.findByText(/belum bisa dibaca|could not be read/i),
    ).toBeTruthy();
    expect(screen.queryByText(/hemat \d+%|save \d+%/i)).toBeNull();
  });
});
