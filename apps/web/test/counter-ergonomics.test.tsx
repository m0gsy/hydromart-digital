// @vitest-environment jsdom
/*
 * Counter ergonomics: the things a cashier does forty times an hour.
 *
 * Typing a quantity, setting a basket aside, clearing it, paying with Enter, seeing how
 * many are left, swapping empties in one tap, knowing whether a number is already a
 * customer, sending the receipt, and a tally of the shift. Each one sits next to money, so
 * each is pinned on what it must NOT do as much as on what it does.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('@/lib/receipt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/receipt')>('@/lib/receipt');
  return { ...actual, printReceipt: () => true };
});
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

const OPENED_AT = '2026-10-23T01:00:00.000Z';

let available = 12;
let quoteExtras: Record<string, unknown> = {};
let quoteBodies: Array<Record<string, any>> = [];
let saleBodies: Array<Record<string, any>> = [];
let quoteGate: Promise<void> | null = null;
let lookupResult: unknown = { registered: false, firstName: null };
let lookupFails = false;
let lookupPaths: string[] = [];
let summaryPaths: string[] = [];
let summary = { orderCount: 3, revenueIdr: 90000 };
let promoReads = 0;
let qrisUrl: string | null = null;
let shiftOpen = true;

beforeEach(() => {
  window.localStorage.clear();
  available = 12;
  quoteExtras = {};
  quoteBodies = [];
  saleBodies = [];
  quoteGate = null;
  lookupResult = { registered: false, firstName: null };
  lookupFails = false;
  lookupPaths = [];
  summaryPaths = [];
  summary = { orderCount: 3, revenueIdr: 90000 };
  promoReads = 0;
  qrisUrl = null;
  shiftOpen = true;
  post.mockReset().mockImplementation(async (path: string, body: Record<string, any>) => {
    const p = String(path);
    if (p.includes('/walk-in/quote')) {
      quoteBodies.push(body);
      const gate = quoteGate;
      quoteGate = null;
      if (gate) await gate;
      const qty = (body.lines as Array<{ quantity: number }>).reduce((n, l) => n + l.quantity, 0);
      return {
        subtotalIdr: qty * 20000,
        discountIdr: 0,
        totalIdr: qty * 20000,
        shippingIdr: 0,
        agen: false,
        catalogFallback: null,
        ...quoteExtras,
      };
    }
    if (p.includes('/walk-in/identify')) return { customerId: 'buyer-1' };
    if (p.includes('/products/batch')) return [AIR];
    if (p.endsWith('/orders/walk-in')) {
      saleBodies.push(body);
      return {
        id: 'o-1',
        orderNumber: 'WI-001',
        total: 20000,
        subtotal: 20000,
        deliveryFee: 0,
        discount: 0,
        customerId: null,
        status: 'COMPLETED',
        createdAt: '2026-10-23T03:00:00.000Z',
        recipientName: 'Budi',
        phone: '08123456789',
        addressLine: 'Ambil langsung di depot',
        city: '-',
        province: '-',
        items: [
          { id: 'i1', productId: 'p-air', productName: 'Air Galon 19L', sku: 'AIR', unit: 'Galon', unitPrice: 20000, quantity: 1, lineTotal: 20000 },
        ],
      };
    }
    if (p.endsWith('/payments/staff')) return { id: 'pay-1' };
    return {};
  });
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('shift-summary')) {
      summaryPaths.push(p);
      return summary;
    }
    if (p.includes('shift')) {
      if (!shiftOpen) return null;
      return {
        id: 's-1',
        depotId: 'depot-1',
        cashierId: 's1',
        cashierName: 'Rina',
        status: 'OPEN',
        openingFloat: 0,
        openedAt: OPENED_AT,
        closedAt: null,
        countedCash: null,
        expectedCash: null,
        variance: null,
        note: null,
      };
    }
    if (p.includes('promo-rules/active')) {
      promoReads += 1;
      return [];
    }
    if (p.includes('counter-lookup')) {
      lookupPaths.push(p);
      if (lookupFails) throw new ApiError(400, 'bad phone', 'BAD');
      return lookupResult;
    }
    if (p.includes('payment-info')) {
      return { name: 'Depot', paymentQrisImageUrl: qrisUrl, paymentBankAccountNumber: null };
    }
    if (p.includes('/vouchers/counter')) return [];
    if (p.includes('/inventory')) {
      return [{ id: 'i1', productId: 'p-air', quantity: available, reserved: 0, available, minimum: 0 }];
    }
    if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
    if (p.includes('/products/batch')) return [AIR];
    return [];
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openTill() {
  const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
  render(<WalkInPage />, { wrapper });
  await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
}

const qtyBox = () => screen.getByLabelText(/^Quantity/) as HTMLInputElement;
const plus = () => screen.getAllByRole('button', { name: /Increase quantity/i })[0]!;
const pay = () => screen.getByTestId('counter-pay') as HTMLButtonElement;
const cashBox = () => screen.getByLabelText(/uang tunai diterima/i) as HTMLInputElement;
const lastQuoteQty = () =>
  (quoteBodies.at(-1)?.lines as Array<{ quantity: number }> | undefined)?.[0]?.quantity;

async function setQty(n: number) {
  await userEvent.click(qtyBox());
  await userEvent.keyboard(`${n}{Enter}`);
}

async function sellOne() {
  await userEvent.click(plus());
  await waitFor(() => expect(pay().disabled).toBe(false));
  await userEvent.type(cashBox(), '20000');
  await userEvent.click(pay());
  await waitFor(() => expect(screen.getByText(/WI-001/)).toBeTruthy());
}

describe('typing the quantity', () => {
  it('prices a typed 9 as 9, not as the 9 taps it replaces', async () => {
    await openTill();
    await setQty(9);
    await waitFor(() => expect(lastQuoteQty()).toBe(9));
    expect(qtyBox().value).toBe('9');
  });

  it('cannot type past what the depot holds', async () => {
    await openTill();
    await setQty(99);
    await waitFor(() => expect(lastQuoteQty()).toBe(12));
    expect(qtyBox().value).toBe('12');
  });

  it('does not quote "2" on the way to typing "20"', async () => {
    available = 50;
    await openTill();
    await userEvent.click(qtyBox());
    await userEvent.keyboard('20');
    expect(quoteBodies).toHaveLength(0);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(lastQuoteQty()).toBe(20));
  });
});

describe('seeing how many are left', () => {
  it('says so once stock is at or below five, and not before', async () => {
    available = 3;
    await openTill();
    expect(screen.getByText(/sisa 3/)).toBeTruthy();
  });

  it('says nothing about a comfortably stocked product', async () => {
    available = 12;
    await openTill();
    expect(screen.queryByText(/sisa \d+/)).toBeNull();
  });
});

describe('clearing the basket', () => {
  it('is offered only when there is something to clear, and empties the lines', async () => {
    await openTill();
    expect(screen.queryByRole('button', { name: /kosongkan keranjang/i })).toBeNull();
    await userEvent.click(plus());
    await userEvent.click(screen.getByRole('button', { name: /kosongkan keranjang/i }));
    expect(qtyBox().value).toBe('0');
    expect(screen.queryByRole('button', { name: /kosongkan keranjang/i })).toBeNull();
    await waitFor(() => expect(pay().disabled).toBe(true));
  });
});

describe('holding a basket', () => {
  const hold = () => userEvent.click(screen.getByRole('button', { name: /tahan keranjang/i }));

  it('sets the basket aside with its buyer, and clears the till for the next one', async () => {
    await openTill();
    await setQty(2);
    await userEvent.type(screen.getByLabelText(/nama pembeli/i), 'Budi');
    await userEvent.type(screen.getByLabelText(/nomor hp/i), '08123456789');
    await hold();

    const card = await screen.findByTestId('counter-held');
    expect(card.textContent).toContain('Budi');
    expect(card.textContent).toContain('2 item');
    expect(qtyBox().value).toBe('0');
    expect((screen.getByLabelText(/nama pembeli/i) as HTMLInputElement).value).toBe('');
    expect(JSON.parse(window.localStorage.getItem('hm.walkin.held.depot-1') as string)).toHaveLength(1);
  });

  it('brings the whole basket back, and removes it from the held list', async () => {
    await openTill();
    await setQty(2);
    await userEvent.type(screen.getByLabelText(/nama pembeli/i), 'Budi');
    await hold();
    await userEvent.click(await screen.findByRole('button', { name: /lanjutkan — budi/i }));

    expect(qtyBox().value).toBe('2');
    expect((screen.getByLabelText(/nama pembeli/i) as HTMLInputElement).value).toBe('Budi');
    expect(screen.queryByTestId('counter-held')).toBeNull();
    expect(window.localStorage.getItem('hm.walkin.held.depot-1')).toBeNull();
  });

  it('will not load a held basket over one being rung up', async () => {
    await openTill();
    await setQty(2);
    await hold();
    await userEvent.click(plus());
    const resume = await screen.findByRole('button', { name: /lanjutkan —/i });
    expect((resume as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/selesaikan atau kosongkan keranjang sekarang dulu/i)).toBeTruthy();
    expect(qtyBox().value).toBe('1');
  });

  it('cuts a held line to the stock that is left, and says so', async () => {
    window.localStorage.setItem(
      'hm.walkin.held.depot-1',
      JSON.stringify([
        { id: 'h1', savedAt: Date.now(), qty: { 'p-air': 20 }, name: 'Sari', phone: '', voucher: '', buyerId: null },
      ]),
    );
    await openTill();
    await userEvent.click(await screen.findByRole('button', { name: /lanjutkan — sari/i }));
    expect(qtyBox().value).toBe('12');
    expect(await screen.findByText(/1 barang disesuaikan karena stok berubah/i)).toBeTruthy();
  });

  it('keeps the basket on screen when this device cannot store it', async () => {
    await openTill();
    await setQty(2);
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    try {
      await hold();
      expect(await screen.findByText(/tidak bisa disimpan di perangkat ini/i)).toBeTruthy();
      expect(qtyBox().value).toBe('2');
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
    }
  });

  it('discards a held basket without touching the one on the till', async () => {
    window.localStorage.setItem(
      'hm.walkin.held.depot-1',
      JSON.stringify([
        { id: 'h1', savedAt: Date.now(), qty: { 'p-air': 1 }, name: 'Sari', phone: '', voucher: '', buyerId: null },
      ]),
    );
    await openTill();
    await userEvent.click(plus());
    await userEvent.click(await screen.findByRole('button', { name: /hapus — sari/i }));
    expect(screen.queryByTestId('counter-held')).toBeNull();
    expect(qtyBox().value).toBe('1');
  });
});

describe('paying with Enter', () => {
  it('sells from the cash box, exactly as the button would', async () => {
    await openTill();
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(false));
    await userEvent.type(cashBox(), '20000{Enter}');
    await waitFor(() => expect(saleBodies).toHaveLength(1));
  });

  it('does nothing while the price is still being worked out', async () => {
    await openTill();
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(false));
    let release!: () => void;
    quoteGate = new Promise<void>((r) => (release = r));
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(true));
    await userEvent.type(cashBox(), '40000{Enter}');
    expect(saleBodies).toHaveLength(0);
    release();
  });

  it('does not sell with no shift open, the one rule only the button gate holds', async () => {
    shiftOpen = false;
    await openTill();
    await userEvent.click(plus());
    await waitFor(() => expect(quoteBodies.length).toBeGreaterThan(0));
    await userEvent.type(cashBox(), '20000{Enter}');
    expect(pay().disabled).toBe(true);
    expect(saleBodies).toHaveLength(0);
  });

  it('does not sell short of the total', async () => {
    await openTill();
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(false));
    await userEvent.type(cashBox(), '5000{Enter}');
    expect(saleBodies).toHaveLength(0);
  });
});

describe('swapping empties', () => {
  it('fills the box with the number bought in one tap', async () => {
    await openTill();
    await setQty(3);
    const box = (await screen.findByLabelText(/galon kosong dibawa/i)) as HTMLInputElement;
    await userEvent.click(screen.getByRole('button', { name: /sama dengan jumlah beli/i }));
    expect(box.value).toBe('3');
  });

  it('says how a partial swap is counted, and a no-swap too', async () => {
    await openTill();
    await setQty(3);
    const box = (await screen.findByLabelText(/galon kosong dibawa/i)) as HTMLInputElement;
    await userEvent.type(box, '1');
    expect(screen.getByText('Tukar 1 dari 3 galon. Sisa 2 dicatat sebagai beli baru.')).toBeTruthy();
    await userEvent.clear(box);
    await userEvent.type(box, '0');
    expect(screen.getByText('Tanpa tukar: semua 3 galon dicatat sebagai beli baru.')).toBeTruthy();
  });

  it('keeps the plain hint for a full swap', async () => {
    await openTill();
    await setQty(3);
    await screen.findByLabelText(/galon kosong dibawa/i);
    await userEvent.click(screen.getByRole('button', { name: /sama dengan jumlah beli/i }));
    expect(screen.queryByText(/dicatat sebagai beli baru/)).toBeNull();
  });
});

describe('the amount, large, for a buyer paying by QRIS', () => {
  it('shows the total big above the QR once the price is settled', async () => {
    qrisUrl = 'https://files.example/qr.png';
    await openTill();
    await setQty(2);
    await waitFor(() => expect(pay().disabled).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'QRIS' }));
    const label = screen.getByText('Total yang harus dibayar');
    expect(label.parentElement?.textContent).toContain('40.000');
  });
});

describe('is this number already a customer?', () => {
  const phone = () => screen.getByLabelText(/nomor hp/i);

  it('says registered, with a first name, after the cashier stops typing', async () => {
    lookupResult = { registered: true, firstName: 'Budi' };
    await openTill();
    await userEvent.type(phone(), '08123456789');
    expect(await screen.findByText('Pelanggan terdaftar: Budi')).toBeTruthy();
    expect(lookupPaths).toHaveLength(1);
    expect(lookupPaths[0]).toContain('phone=08123456789');
  });

  it('says a new number is not registered yet, and that nothing is created by asking', async () => {
    await openTill();
    await userEvent.type(phone(), '08123456789');
    expect(await screen.findByText(/belum terdaftar/i)).toBeTruthy();
  });

  it('does not ask for a number that is too short to be one', async () => {
    await openTill();
    await userEvent.type(phone(), '0812');
    await new Promise((r) => setTimeout(r, 700));
    expect(lookupPaths).toHaveLength(0);
  });

  it('shows nothing when the lookup fails, and the till still works', async () => {
    lookupFails = true;
    await openTill();
    await userEvent.type(phone(), '08123456789');
    await waitFor(() => expect(lookupPaths).toHaveLength(1));
    expect(screen.queryByText(/terdaftar/i)).toBeNull();
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(false));
  });

  it('is replaced by the identified state once the cashier taps Cek pelanggan', async () => {
    lookupResult = { registered: true, firstName: 'Budi' };
    await openTill();
    await userEvent.type(phone(), '08123456789');
    await screen.findByText('Pelanggan terdaftar: Budi');
    await userEvent.click(screen.getByRole('button', { name: /cek pelanggan/i }));
    await waitFor(() => expect(screen.queryByText('Pelanggan terdaftar: Budi')).toBeNull());
  });

  it('forgets an answer when the number changes', async () => {
    lookupResult = { registered: true, firstName: 'Budi' };
    await openTill();
    await userEvent.type(phone(), '08123456789');
    await screen.findByText('Pelanggan terdaftar: Budi');
    await userEvent.type(phone(), '0');
    expect(screen.queryByText('Pelanggan terdaftar: Budi')).toBeNull();
  });
});

describe('a new customer', () => {
  it('is badged once identified, so a first-order promo explains the price', async () => {
    quoteExtras = { firstOrder: true };
    await openTill();
    await userEvent.click(plus());
    await userEvent.type(screen.getByLabelText(/nomor hp/i), '08123456789');
    await userEvent.click(screen.getByRole('button', { name: /cek pelanggan/i }));
    expect(await screen.findByText('Pelanggan baru')).toBeTruthy();
    expect(screen.getByText(/promo khusus pelanggan baru berlaku/i)).toBeTruthy();
  });

  it('is not badged for a returning customer', async () => {
    quoteExtras = { firstOrder: false };
    await openTill();
    await userEvent.click(plus());
    await userEvent.type(screen.getByLabelText(/nomor hp/i), '08123456789');
    await userEvent.click(screen.getByRole('button', { name: /cek pelanggan/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /pelanggan dikenali/i })).toBeTruthy());
    expect(screen.queryByText('Pelanggan baru')).toBeNull();
  });

  it('is not badged before anyone is identified', async () => {
    quoteExtras = { firstOrder: true };
    await openTill();
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(false));
    expect(screen.queryByText('Pelanggan baru')).toBeNull();
  });
});

describe('the shift tally', () => {
  it('shows what this cashier has rung up since the shift opened, and no drawer figure', async () => {
    await openTill();
    const tally = await screen.findByTestId('counter-shift-tally');
    expect(tally.textContent).toBe('Shift ini: 3 transaksi · Rp 90.000');
    expect(summaryPaths[0]).toContain('depotId=depot-1');
    expect(summaryPaths[0]).toContain(`from=${encodeURIComponent(OPENED_AT)}`);
    expect(document.body.textContent).not.toMatch(/seharusnya|laci/i);
  });

  it('follows a sale', async () => {
    await openTill();
    await screen.findByTestId('counter-shift-tally');
    const before = summaryPaths.length;
    summary = { orderCount: 4, revenueIdr: 110000 };
    await sellOne();
    await waitFor(() => expect(summaryPaths.length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(screen.getByTestId('counter-shift-tally').textContent).toBe('Shift ini: 4 transaksi · Rp 110.000'),
    );
  });

  it('shows nothing, and the till still sells, when it cannot be read', async () => {
    get.mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.includes('shift-summary')) throw new Error('down');
      if (p.includes('shift')) {
        return { id: 's-1', depotId: 'depot-1', cashierId: 's1', cashierName: 'Rina', status: 'OPEN', openingFloat: 0, openedAt: OPENED_AT, closedAt: null, countedCash: null, expectedCash: null, variance: null, note: null };
      }
      if (p.includes('/inventory')) return [{ id: 'i1', productId: 'p-air', quantity: 12, reserved: 0, available: 12, minimum: 0 }];
      if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
      if (p.includes('/products/batch')) return [AIR];
      return [];
    });
    await openTill();
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(false));
    expect(screen.queryByTestId('counter-shift-tally')).toBeNull();
  });
});

describe('sending the receipt', () => {
  it('opens the buyer’s chat with the receipt typed, for the number the cashier collected', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    window.open = open;
    await openTill();
    await userEvent.type(screen.getByLabelText(/nomor hp/i), '08123456789');
    await sellOne();
    await userEvent.click(await screen.findByRole('button', { name: /kirim struk via whatsapp/i }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]![0]);
    expect(url.startsWith('https://wa.me/628123456789?text=')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]!);
    expect(text).toContain('WI-001');
    expect(text).toContain('Air Galon 19L');
    expect(text).toContain('Rp 20.000');
    expect(open.mock.calls[0]![2]).toContain('noopener');
  });

  it('is not offered for a sale with no phone number', async () => {
    await openTill();
    await sellOne();
    expect(screen.queryByRole('button', { name: /kirim struk via whatsapp/i })).toBeNull();
  });
});

describe('the promo strip stays current', () => {
  it('re-reads the live promos on the same beat as the stock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openTill();
    const before = promoReads;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_100);
    });
    expect(promoReads).toBeGreaterThan(before);
  });
});

describe('after a sale', () => {
  it('puts focus back on the first product, not on a text box', async () => {
    await openTill();
    await sellOne();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Increase quantity'),
    );
  });

  it('keeps the recent sales below the till, so products and Bayar come first', async () => {
    await openTill();
    const product = screen.getByText('Air Galon 19L');
    const recent = screen.getByText(/penjualan konter terakhir/i);
    expect(product.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps total and Bayar together in a bar that stays on screen', async () => {
    await openTill();
    await userEvent.click(plus());
    await waitFor(() => expect(pay().disabled).toBe(false));
    const bar = pay().closest('.sticky') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(within(bar).getByText('Total')).toBeTruthy();
  });
});
