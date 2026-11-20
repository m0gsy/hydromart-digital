// @vitest-environment jsdom
/**
 * P1c (owner decision 2026-11-20): no order without a map pin.
 *
 * The depot picker that stood in for a pin is gone — it priced an order at whichever depot
 * the customer liked. What replaces it has to be usable: the manual coordinate boxes could
 * not take "-" or "." at all, a corrected name or phone threw the pin away, and a one-off
 * note for this order overwrote the saved landmark without asking.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/checkout',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import CheckoutPage from '@/app/checkout/page';
import { parseLatLngPair } from '@/lib/addresses';

const HOME = {
  id: 'a-1',
  label: 'Rumah',
  recipientName: 'Wahyu',
  phone: '081234567890',
  addressLine: 'Jl. Satu 1',
  city: 'Jakarta',
  latitude: -6.2,
  longitude: 106.8,
  notes: 'Pagar hijau',
  isPrimary: true,
};

const DEPOT = {
  id: 'd-1',
  code: 'D1',
  name: 'Depot Satu',
  city: 'Jakarta',
  lat: -6.2,
  lng: 106.8,
  serviceRadiusKm: 10,
  deliveryFee: 5_000,
  minOrderAmount: null,
  distanceKm: 1,
  withinService: true,
  acceptsTransfer: true,
  acceptsQris: true,
  holidays: [],
};

const CART = {
  items: [
    {
      productId: 'p1',
      productName: 'Galon 19L',
      sku: 'AIR-19L',
      unit: 'Galon 19L',
      unitPrice: 20_000,
      quantity: 1,
      lineTotal: 20_000,
      isGallon: true,
    },
  ],
  subtotal: 20_000,
  depotId: 'd-1',
  pricingBasis: 'DEPOT',
  reseller: null,
};

const serve = (addresses: unknown[]) => {
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/cart')) return CART;
    if (p.includes('/depots/nearby')) return [DEPOT];
    if (p.includes('delivery-options')) return { expressEnabled: false, expressFee: 0, slots: [] };
    if (p.includes('/loyalty/')) return { tier: 'REGULAR', discountRate: 0, pointsBalance: 0 };
    if (p.includes('/addresses')) return addresses;
    return [];
  });
};

const draw = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <CheckoutPage />
      </ToastProvider>
    </LocaleProvider>,
  );

const submitButtons = () => screen.getAllByRole('button', { name: /Buat pesanan/i });
const openAddress = async () =>
  fireEvent.click((await screen.findAllByText(/Alamat pengiriman/))[0]!);
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(() => {
  post.mockReset().mockResolvedValue({ id: 'o-1', total: 25_000 });
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('no pin, no order', () => {
  it('refuses the button and says why, with no depot to pick instead', async () => {
    serve([]);
    draw();

    expect((await screen.findAllByText(/Pasang pin lokasi alamat ini dulu/)).length).toBeGreaterThan(0);
    for (const b of submitButtons()) expect(b).toBeDisabled();
    expect(screen.queryByText(/Pilih depot pengantar/)).toBeNull();
    expect(get.mock.calls.some(([p]) => String(p).includes('/depots/api/v1/depots?'))).toBe(false);
  });

  it('routes by the saved pin and names the depot it chose', async () => {
    serve([HOME]);
    draw();

    expect((await screen.findAllByText('Diantar dari Depot Satu')).length).toBeGreaterThan(0);
    await waitFor(() => expect(submitButtons()[0]).toBeEnabled());
  });
});

describe('the manual coordinates', () => {
  const openManual = async () => {
    serve([]);
    draw();
    await openAddress();
    fireEvent.click(await screen.findByText('Masukkan koordinat manual'));
  };

  it('take a minus sign and a decimal point while being typed', async () => {
    await openManual();
    for (const typed of ['-', '-6', '-6.', '-6.9147']) {
      fireEvent.change(field('ck-lat'), { target: { value: typed } });
      expect(field('ck-lat').value).toBe(typed);
    }
    // ...and it counts once the box is left, not per keystroke (each digit re-routed the pin).
    expect(get.mock.calls.some(([p]) => String(p).includes('/depots/nearby'))).toBe(false);
    fireEvent.blur(field('ck-lat'));
    expect(field('ck-lat').value).toBe('-6.9147');
  });

  it('fill both boxes from a pasted "lat, lng" or a Maps link', async () => {
    await openManual();
    fireEvent.change(field('ck-lat'), { target: { value: '-6.914744, 107.609810' } });
    expect(field('ck-lat').value).toBe('-6.914744');
    expect(field('ck-lng').value).toBe('107.60981');

    fireEvent.change(field('ck-lng'), {
      target: { value: 'https://www.google.com/maps/place/X/@-6.1,106.1,17z/data=!3d-6.2001!4d106.8002' },
    });
    expect(field('ck-lat').value).toBe('-6.2001');
    expect(field('ck-lng').value).toBe('106.8002');
  });
});

describe('editing the address', () => {
  it('keeps the pin when the name or phone is corrected, and drops it when the street changes', async () => {
    serve([]);
    draw();
    await openAddress();
    fireEvent.change(field('addressLine'), { target: { value: 'Jl. Baru 3' } });
    fireEvent.change(field('city'), { target: { value: 'Jakarta' } });
    fireEvent.click(await screen.findByText('Masukkan koordinat manual'));
    fireEvent.change(field('ck-lat'), { target: { value: '-6.2001, 106.8001' } });
    // The pin routes to a depot and the cart re-prices for it (the page blanks while it does).
    expect((await screen.findAllByText('Diantar dari Depot Satu')).length).toBeGreaterThan(0);
    await waitFor(() => expect(field('recipientName')).not.toBeNull());
    expect(submitButtons()[0]).toBeEnabled();

    fireEvent.change(field('recipientName'), { target: { value: 'Wahyu A.' } });
    fireEvent.change(field('phone'), { target: { value: '081200000000' } });
    expect(submitButtons()[0]).toBeEnabled();

    fireEvent.change(field('addressLine'), { target: { value: 'Jl. Lain 9' } });
    await waitFor(() => expect(submitButtons()[0]).toBeDisabled());
  });

  it('asks before a note for this order overwrites the saved patokan', async () => {
    serve([HOME]);
    draw();
    await waitFor(() => expect(submitButtons()[0]).toBeEnabled());
    await openAddress();

    fireEvent.change(field('courierNotes'), { target: { value: 'Titip satpam hari ini' } });
    const keep = screen.getByRole('checkbox', { name: /Simpan juga sebagai patokan/ });
    expect(keep).toBeChecked();
    fireEvent.click(keep);
    fireEvent.click(submitButtons()[0]!);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/payments'),
        expect.anything(),
        true,
      ),
    );
    expect(patch).not.toHaveBeenCalled();
    // The order itself still carries this order's note.
    expect(post.mock.calls[0]![1]).toMatchObject({
      deliveryAddress: { notes: 'Titip satpam hari ini' },
    });
  });
});

describe('a saved address with no pin', () => {
  it('offers the pin controls, and saves the pin taken here to that address', async () => {
    serve([{ ...HOME, latitude: null, longitude: null }]);
    draw();
    await openAddress();

    expect(await screen.findByText(/Alamat tersimpan ini belum punya pin/)).toBeTruthy();
    fireEvent.click(await screen.findByText('Masukkan koordinat manual'));
    fireEvent.change(field('ck-lat'), { target: { value: '-6.2001, 106.8001' } });
    expect((await screen.findAllByText('Diantar dari Depot Satu')).length).toBeGreaterThan(0);
    await waitFor(() => expect(submitButtons()[0]).toBeEnabled());
    fireEvent.click(submitButtons()[0]!);

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        expect.stringContaining('/addresses/a-1'),
        { latitude: -6.2001, longitude: 106.8001 },
        true,
      ),
    );
  });
});

describe('parseLatLngPair', () => {
  it.each([
    ['-6.914744, 107.609810', { latitude: -6.914744, longitude: 107.60981 }],
    ['−6.9147,107.6098', { latitude: -6.9147, longitude: 107.6098 }],
    ['https://maps.google.com/?q=-6.9147%2C107.6098', { latitude: -6.9147, longitude: 107.6098 }],
    ['https://www.google.com/maps/@-6.9147,107.6098,17z', { latitude: -6.9147, longitude: 107.6098 }],
  ])('reads %s', (text, pin) => {
    expect(parseLatLngPair(text)).toEqual(pin);
  });

  it('takes two decimals, the precision people copy by hand', () => {
    expect(parseLatLngPair('-6.91, 107.61')).toEqual({ latitude: -6.91, longitude: 107.61 });
  });

  it.each([
    'https://maps.app.goo.gl/abc',
    '-6.9',
    '0.000, 0.000',
    '95.1234, 10.1234',
    '107.6098, -6.9147',
    'pagar hijau',
  ])(
    'gives null for %s',
    (text) => {
      expect(parseLatLngPair(text)).toBeNull();
    },
  );
});
