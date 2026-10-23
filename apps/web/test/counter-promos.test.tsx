// @vitest-environment jsdom
/*
 * The cashier could not tell which promo was on. The server applied them (the quote has
 * priced the COUNTER channel for a while) but the screen showed one anonymous "Diskon" line,
 * a price promo vanished from the arithmetic altogether (Subtotal − Diskon ≠ Total), a
 * voucher had to be typed from memory, and nothing said what was running today.
 *
 * Pinned here: the strip of live promos, the promo rows that make the total add up, the
 * one-tap list of the identified buyer's granted vouchers — and that the identified buyer is
 * forgotten once the sale is rung, or the next person at the till is priced (and spends a
 * voucher) as the last one.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/walk-in',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 's1', role: 'KEPALA_DEPOT', assignedDepotId: 'depot-1' },
    ready: true,
  }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch } };
});
vi.mock('@/lib/receipt', () => ({ printReceipt: () => true }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'depot-1', ready: true, error: null, reload: vi.fn(), depots: [] }),
}));
vi.mock('@/lib/roles', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roles')>('@/lib/roles');
  return { ...actual, canRecordWalkInSale: () => true };
});

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

const AIR = {
  id: 'p-air',
  name: 'Air Galon 19L',
  basePrice: 20000,
  unit: 'Galon',
  isGallon: true,
  imageUrl: null,
  categoryId: null,
};

const rule = (o: Record<string, unknown>) => ({
  id: 'r-1',
  name: 'Promo',
  kind: 'SPECIAL_PRICE',
  depotId: null,
  productId: null,
  categoryId: null,
  specialPrice: null,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  percentOff: null,
  minSubtotal: null,
  discountAmount: null,
  giftProductId: null,
  firstOrderOnly: false,
  validFrom: null,
  validUntil: null,
  daysOfWeek: [],
  startTime: null,
  endTime: null,
  minQty: 1,
  maxQty: null,
  channels: [],
  active: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...o,
});

const voucher = (o: Record<string, unknown> = {}) => ({
  code: 'MAAF10',
  description: null,
  discountType: 'PERCENTAGE',
  value: 10,
  minSpend: 0,
  maxDiscount: null,
  validUntil: null,
  status: 'AVAILABLE',
  ...o,
});

let activeRules: unknown[] | 'fail' = [];
let granted: unknown[] = [];
let quoteExtras: Record<string, unknown> = {};
let quoteBodies: Array<Record<string, unknown>> = [];
let voucherPaths: string[] = [];
/** When set, the NEXT quote waits on it; when 'fail', the next quote is refused. */
let quoteGate: Promise<void> | 'fail' | null = null;
let recentReads = 0;

beforeEach(() => {
  activeRules = [];
  granted = [];
  quoteExtras = {};
  quoteBodies = [];
  voucherPaths = [];
  quoteGate = null;
  recentReads = 0;
  post.mockReset().mockImplementation(async (path: string, body: Record<string, unknown>) => {
    const p = String(path);
    if (p.includes('/walk-in/quote')) {
      quoteBodies.push(body);
      const gate = quoteGate;
      quoteGate = null;
      if (gate === 'fail') throw new ApiError(400, 'Voucher tidak berlaku.', 'VOUCHER_INVALID');
      if (gate) await gate;
      return {
        subtotalIdr: 20000,
        discountIdr: 0,
        totalIdr: 20000,
        shippingIdr: 0,
        agen: false,
        catalogFallback: null,
        ...quoteExtras,
      };
    }
    if (p.includes('/walk-in/identify')) return { customerId: 'buyer-1' };
    if (p.includes('/products/batch')) return [AIR];
    if (p.endsWith('/orders/walk-in')) {
      return { id: 'o-1', orderNumber: 'WI-001', total: 20000, customerId: 'buyer-1', status: 'COMPLETED' };
    }
    if (p.endsWith('/payments/staff')) return { id: 'pay-1' };
    return {};
  });
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('shift')) {
      return {
        id: 's-1',
        depotId: 'depot-1',
        cashierId: 's1',
        cashierName: 'Rina',
        status: 'OPEN',
        openingFloat: 0,
        openedAt: '2026-08-25T08:00:00.000Z',
        closedAt: null,
        countedCash: null,
        expectedCash: null,
        variance: null,
        note: null,
      };
    }
    if (p.includes('promo-rules/active')) {
      if (activeRules === 'fail') throw new Error('promo-service down');
      return activeRules;
    }
    if (p.includes('/vouchers/counter')) {
      voucherPaths.push(p);
      return granted;
    }
    if (p.includes('/inventory')) {
      return [{ id: 'i1', productId: 'p-air', quantity: 12, reserved: 0, available: 12, minimum: 0 }];
    }
    if (p.includes('/orders/manage')) {
      recentReads += 1;
      return { items: [], total: 0, page: 1, limit: 8 };
    }
    if (p.includes('/products/batch')) return [AIR];
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

async function openTill() {
  const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
  render(<WalkInPage />, { wrapper });
  await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
}

const addOneGalon = () =>
  userEvent.click(screen.getAllByRole('button', { name: /Increase quantity/i })[0]!);

async function identifyBuyer() {
  await userEvent.type(screen.getByLabelText(/nomor hp/i), '08123456789');
  await userEvent.click(screen.getByRole('button', { name: /cek pelanggan/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /pelanggan dikenali/i })).toBeTruthy());
}

describe('the strip of promos running now', () => {
  it('says what each live promo does, in words a cashier can repeat to the buyer', async () => {
    activeRules = [
      rule({ id: 'a', name: 'Beli 2 Gratis 1', kind: 'BUY_X_GET_Y', buyQty: 2, getQty: 1, productId: 'p-air' }),
      rule({ id: 'b', name: 'Jumat Berkah', kind: 'SPECIAL_PRICE', specialPrice: 6000, endTime: '12:00' }),
      rule({ id: 'c', name: 'Belanja Hemat', kind: 'ORDER_DISCOUNT', discountAmount: 5000, minSubtotal: 50000 }),
      rule({ id: 'd', name: 'Ongkir Murah', kind: 'SHIPPING_DISCOUNT', shippingFeeOverride: 1000 }),
      rule({ id: 'e', name: 'Diskon Baru', kind: 'PERCENTAGE_OFF', percentOff: 15, firstOrderOnly: true, minQty: 3 }),
    ];
    await openTill();
    const strip = await screen.findByTestId('counter-promo-strip');
    const text = strip.textContent ?? '';
    expect(text).toContain('Beli 2 Gratis 1');
    expect(text).toContain('Beli 2 gratis 1 · Air Galon 19L');
    expect(text).toContain('Harga Rp 6.000 · sampai 12:00');
    expect(text).toContain('Potong Rp 5.000, min. belanja Rp 50.000');
    expect(text).toContain('Ongkir Rp 1.000 per galon');
    expect(text).toContain('Diskon 15% · min. 3 pcs · pelanggan baru');
  });

  it('is absent when nothing is running', async () => {
    await openTill();
    expect(screen.queryByTestId('counter-promo-strip')).toBeNull();
  });

  it('never gets in the way of selling when the list cannot be read', async () => {
    activeRules = 'fail';
    await openTill();
    expect(screen.queryByTestId('counter-promo-strip')).toBeNull();
    expect(screen.queryByText(/promo-service down/i)).toBeNull();
    await addOneGalon();
    await waitFor(() => expect(screen.getByLabelText(/uang tunai diterima/i)).toBeTruthy());
  });
});

describe("the identified buyer's own vouchers, one tap", () => {
  it('offers nothing before the buyer is identified, and asks for nothing', async () => {
    granted = [voucher()];
    await openTill();
    expect(screen.queryByText(/pilih voucher pembeli/i)).toBeNull();
    expect(voucherPaths).toEqual([]);
  });

  it("lists the buyer's granted vouchers once identified, scoped to this buyer and depot", async () => {
    granted = [
      voucher(),
      voucher({ code: 'ONGKIR', discountType: 'FREE_SHIPPING', value: 0, minSpend: 30000 }),
      voucher({ code: 'POTONG5K', discountType: 'FIXED', value: 5000 }),
    ];
    await openTill();
    await identifyBuyer();
    expect(await screen.findByRole('button', { name: /MAAF10 · 10%/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ONGKIR · Gratis ongkir · min\. Rp 30\.000/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /POTONG5K · Rp 5\.000/ })).toBeTruthy();
    expect(voucherPaths[0]).toContain('customerId=buyer-1');
    expect(voucherPaths[0]).toContain('depotId=depot-1');
  });

  it('fills the voucher box on a tap, prices with it, and clears on a second tap', async () => {
    granted = [voucher()];
    await openTill();
    await addOneGalon();
    await identifyBuyer();

    const chip = await screen.findByRole('button', { name: /MAAF10/ });
    await userEvent.click(chip);
    expect((screen.getByLabelText(/kode voucher/i) as HTMLInputElement).value).toBe('MAAF10');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(quoteBodies.at(-1)?.voucherCode).toBe('MAAF10'));

    await userEvent.click(chip);
    expect((screen.getByLabelText(/kode voucher/i) as HTMLInputElement).value).toBe('');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows no list for a buyer with no granted vouchers, and the box still works', async () => {
    granted = [];
    await openTill();
    await identifyBuyer();
    expect(screen.queryByText(/pilih voucher pembeli/i)).toBeNull();
    await userEvent.type(screen.getByLabelText(/kode voucher/i), 'hemat10');
    expect((screen.getByLabelText(/kode voucher/i) as HTMLInputElement).value).toBe('HEMAT10');
  });

  it('forgets the buyer once the sale is rung, so the next one is priced as nobody', async () => {
    granted = [voucher()];
    await openTill();
    await addOneGalon();
    await identifyBuyer();
    await screen.findByRole('button', { name: /MAAF10/ });
    await waitFor(() => expect(quoteBodies.at(-1)?.customerId).toBe('buyer-1'));

    await userEvent.type(screen.getByLabelText(/uang tunai diterima/i), '20000');
    await userEvent.click(screen.getByRole('button', { name: /simpan & cetak struk/i }));
    await waitFor(() => expect(screen.getByText(/WI-001/)).toBeTruthy());

    // The buyer's list is gone with the buyer…
    await waitFor(() => expect(screen.queryByText(/pilih voucher pembeli/i)).toBeNull());
    // …and the next basket is quoted for nobody.
    quoteBodies = [];
    await addOneGalon();
    await waitFor(() => expect(quoteBodies.length).toBeGreaterThan(0));
    expect(quoteBodies.at(-1)?.customerId).toBeUndefined();
    expect(screen.getByRole('button', { name: /cek pelanggan/i })).toBeTruthy();
  });
});

describe('the promo rows that make the total add up', () => {
  it('takes a price promo out of the subtotal by name, so the total is not a mystery', async () => {
    quoteExtras = {
      subtotalIdr: 14000,
      totalIdr: 14000,
      appliedPromos: [{ name: 'Jumat Berkah', effect: 'PRICE', amountIdr: 6000 }],
    };
    await openTill();
    await addOneGalon();
    const row = (await screen.findByText('Jumat Berkah')).parentElement as HTMLElement;
    expect(within(row).getByText(/−/)).toBeTruthy();
    expect(row.textContent).toContain('6.000');
  });

  it('names an order promo inside the discount line rather than listing it twice', async () => {
    quoteExtras = {
      discountIdr: 5000,
      totalIdr: 15000,
      appliedPromos: [{ name: 'Belanja Hemat', effect: 'ORDER', amountIdr: 5000 }],
    };
    await openTill();
    await addOneGalon();
    const label = await screen.findByText(/termasuk Belanja Hemat/);
    expect(label.textContent).toContain('(termasuk Belanja Hemat)');
    expect(screen.getAllByText(/Belanja Hemat/)).toHaveLength(1);
  });

  it('says what free goods and a cheaper ongkir were worth, without subtracting them again', async () => {
    quoteExtras = {
      appliedPromos: [
        { name: 'Beli 1 Gratis 1', effect: 'FREE', amountIdr: 20000 },
        { name: 'Bonus Tutup', effect: 'GIFT', amountIdr: 3000 },
        { name: 'Ongkir Murah', effect: 'SHIPPING', amountIdr: 1500 },
      ],
    };
    await openTill();
    await addOneGalon();
    expect(await screen.findByText('gratis senilai Rp 20.000')).toBeTruthy();
    expect(screen.getByText('gratis senilai Rp 3.000')).toBeTruthy();
    expect(screen.getByText('hemat ongkir Rp 1.500')).toBeTruthy();
    expect(screen.queryByText(/−/)).toBeNull();
  });

  it('shows nothing extra against a server that predates the breakdown', async () => {
    await openTill();
    await addOneGalon();
    await waitFor(() => expect(quoteBodies.length).toBeGreaterThan(0));
    expect(screen.queryByText(/termasuk/)).toBeNull();
    expect(screen.queryByText(/gratis senilai/)).toBeNull();
  });
});

describe('the pay button only charges a total that belongs to this basket', () => {
  const pay = () => screen.getByTestId('counter-pay') as HTMLButtonElement;

  it('waits for the new quote after the basket changes, instead of charging the last one', async () => {
    await openTill();
    await addOneGalon();
    await waitFor(() => expect(pay().disabled).toBe(false));

    let release!: () => void;
    quoteGate = new Promise<void>((r) => (release = r));
    await addOneGalon();
    // The previous total is still on screen, but it is not this basket's.
    await waitFor(() => expect(pay().disabled).toBe(true));
    release();
    await waitFor(() => expect(pay().disabled).toBe(false));
  });

  it('stays shut while the quote is refused, rather than selling at the last good total', async () => {
    await openTill();
    await addOneGalon();
    await waitFor(() => expect(pay().disabled).toBe(false));

    quoteGate = 'fail';
    await addOneGalon();
    expect(await screen.findByText('Voucher tidak berlaku.')).toBeTruthy();
    expect(pay().disabled).toBe(true);
    expect(post.mock.calls.some(([path]) => String(path).endsWith('/orders/walk-in'))).toBe(false);
  });
});

describe('what the till remembers between buyers', () => {
  it("drops a voucher picked from a buyer's list when the phone number is changed", async () => {
    granted = [voucher()];
    await openTill();
    await identifyBuyer();
    await userEvent.click(await screen.findByRole('button', { name: /MAAF10/ }));
    expect((screen.getByLabelText(/kode voucher/i) as HTMLInputElement).value).toBe('MAAF10');

    await userEvent.type(screen.getByLabelText(/nomor hp/i), '9');
    expect((screen.getByLabelText(/kode voucher/i) as HTMLInputElement).value).toBe('');
  });

  it('keeps a voucher the cashier typed themselves when the phone changes', async () => {
    granted = [voucher()];
    await openTill();
    await identifyBuyer();
    await screen.findByRole('button', { name: /MAAF10/ });
    await userEvent.type(screen.getByLabelText(/kode voucher/i), 'hemat10');
    await userEvent.type(screen.getByLabelText(/nomor hp/i), '9');
    expect((screen.getByLabelText(/kode voucher/i) as HTMLInputElement).value).toBe('HEMAT10');
  });

  it("puts the sale just made into the till's own recent list", async () => {
    await openTill();
    await addOneGalon();
    await waitFor(() => expect(pay2().disabled).toBe(false));
    const before = recentReads;
    await userEvent.type(screen.getByLabelText(/uang tunai diterima/i), '20000');
    await userEvent.click(screen.getByRole('button', { name: /simpan & cetak struk/i }));
    await waitFor(() => expect(screen.getByText(/WI-001/)).toBeTruthy());
    await waitFor(() => expect(recentReads).toBeGreaterThan(before));
  });
});

const pay2 = () => screen.getByTestId('counter-pay') as HTMLButtonElement;
