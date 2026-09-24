// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * CA-2-04 — two HQ screens read `GET /depots/api/v1/depots/:id`, the `@Public()`
 * projection, while typing the answer `DepotAdmin`. Nothing in TypeScript catches that:
 * the route is typed by the caller, and the caller asserted the shape it wanted.
 *
 * The projection drops `paymentBank*`, `paymentQrisImageUrl`, `ownerId`, `ownershipType`
 * and `contactPhone`, and it is served `activeOnly`. So the fake below is not a
 * convenience — it IS the test. The public path answers with the narrow row (and refuses
 * a suspended depot); the admin path answers in full. A screen pointed at the wrong one
 * fails here for exactly the reason it failed in production.
 */

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'dep-1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/depots/detail',
}));

import { LocaleProvider } from '@/lib/locale-context';
import HqDepotDetailPage from '@/app/hq/depots/detail/page';
import HqOnboardingPage from '@/app/hq/onboarding/page';

const ADMIN_ROW = {
  id: 'dep-1',
  code: 'DPT-01',
  name: 'Depot Menteng',
  ownershipType: 'WARALABA',
  ownerId: 'own-1',
  address: 'Jl. Menteng 1',
  city: 'Jakarta',
  province: 'DKI Jakarta',
  lat: -6.1944,
  lng: 106.8412,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  contactPhone: '081234567890',
  paymentBankName: 'BCA',
  paymentBankAccountNumber: '1234567890',
  paymentBankAccountHolder: 'PT Hydromart',
  paymentQrisImageUrl: 'https://cdn.example.id/qris.png',
  operatingHours: {},
  holidays: [],
  active: true,
};

// What `PublicDepotView.from` actually puts on the wire (depot.dto.ts:219).
const PUBLIC_KEYS = [
  'id',
  'code',
  'name',
  'address',
  'city',
  'province',
  'lat',
  'lng',
  'serviceRadiusKm',
  'deliveryFee',
  'minOrderAmount',
  'operatingHours',
  'holidays',
  'active',
] as const;

function publicProjection(row: typeof ADMIN_ROW): Record<string, unknown> {
  return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, row[k]]));
}

/** The two depot routes, told apart the way the server tells them apart. */
function serveDepot(row = ADMIN_ROW) {
  get.mockImplementation((path: string) => {
    if (path.includes('/depots/manage/')) return Promise.resolve(row);
    if (/\/depots\/api\/v1\/depots\/[^/?]+$/.test(path)) {
      // `activeOnly`: the public route cannot see a suspended depot at all.
      return row.active
        ? Promise.resolve(publicProjection(row))
        : Promise.reject(new Error('Depot not found.'));
    }
    if (path.includes('/depots/manage')) return Promise.resolve({ items: [row], total: 1 });
    if (path.includes('/inventory'))
      return Promise.resolve([
        {
          id: 'i-1',
          label: 'Galon 19L',
          available: 4,
          quantity: 10,
          minimumStock: 2,
          unit: 'galon',
          lowStock: false,
        },
      ]);
    if (path.includes('/staff')) return Promise.resolve({ items: [{ id: 'u-1' }], total: 1 });
    if (path.includes('/rollup')) return Promise.resolve({ depots: [] });
    if (path.includes('/orders')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve(null);
  });
}

const renderPage = (node: React.ReactElement) => render(<LocaleProvider>{node}</LocaleProvider>);

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('hq/depots/detail reads the admin record', () => {
  it('prefills the edit form with the bank account it is about to PATCH back', async () => {
    serveDepot();
    const user = userEvent.setup();
    renderPage(<HqDepotDetailPage />);

    await user.click(await screen.findByRole('button', { name: /Ubah|Edit/i }));

    // Read off the public projection these are blank, and `toDepotPayload` sends
    // `paymentBankAccountNumber: null` — one save empties the depot's payment details.
    expect(document.querySelector<HTMLInputElement>('#d-acct')?.value).toBe('1234567890');
    expect(document.querySelector<HTMLInputElement>('#d-bank')?.value).toBe('BCA');
    expect(document.querySelector<HTMLInputElement>('#d-holder')?.value).toBe('PT Hydromart');
    expect(document.querySelector<HTMLInputElement>('#d-qris')?.value).toBe(
      'https://cdn.example.id/qris.png',
    );
    expect(document.querySelector<HTMLInputElement>('#d-phone')?.value).toBe('081234567890');
  });

  it('names a franchise depot as one', async () => {
    serveDepot();
    renderPage(<HqDepotDetailPage />);
    // `ownershipType` is absent from the projection, so the badge read "central" for
    // every franchise depot in the network.
    // Anchored: "Payout waralaba tertunda" — the card that only renders because
    // `ownerId` now arrives at all — contains the word too.
    expect(await screen.findByText(/^(Waralaba|Franchise)$/i)).toBeTruthy();
  });

  it('opens a suspended depot — the only screen with its reactivate button', async () => {
    serveDepot({ ...ADMIN_ROW, active: false });
    renderPage(<HqDepotDetailPage />);

    expect(await screen.findByText('Depot Menteng')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Aktifkan|Reactivate/i })).toBeTruthy();
  });
});

describe('hq/onboarding counts the payment step', () => {
  // The fixture depot is a franchise depot (so the owner step applies) that entered a bank
  // account but no opening hours — which is exactly the shape the checklist used to call ready.
  const HOURS = { mon: { open: '08:00', close: '21:00' } };

  it('ticks payments once the depot has a bank account, and does not tick hours it never entered', async () => {
    serveDepot();
    renderPage(<HqOnboardingPage />);

    const select = await screen.findByRole('combobox');
    await userEvent.setup().selectOptions(select, 'dep-1');

    // 7 of 8: legal, survey, provision, owner, stock, staff and payments — but NOT hours.
    // Read off the public projection the payment step can never tick, whatever the depot's
    // actual setup — the checklist is stuck one short forever; and a depot with no opening
    // hours (`{}` means shut) used to read as fully ready.
    expect(await screen.findByText('7/8 langkah selesai')).toBeTruthy();
  });

  it('is complete once the depot has entered its opening hours', async () => {
    serveDepot({ ...ADMIN_ROW, operatingHours: HOURS } as typeof ADMIN_ROW);
    renderPage(<HqOnboardingPage />);

    const select = await screen.findByRole('combobox');
    await userEvent.setup().selectOptions(select, 'dep-1');

    expect(await screen.findByText('8/8 langkah selesai')).toBeTruthy();
  });

  it('leaves the owner step out for a company depot', async () => {
    serveDepot({
      ...ADMIN_ROW,
      ownershipType: 'HKP',
      ownerId: null,
      operatingHours: HOURS,
    } as unknown as typeof ADMIN_ROW);
    renderPage(<HqOnboardingPage />);

    const select = await screen.findByRole('combobox');
    await userEvent.setup().selectOptions(select, 'dep-1');

    expect(await screen.findByText('7/7 langkah selesai')).toBeTruthy();
  });
});
