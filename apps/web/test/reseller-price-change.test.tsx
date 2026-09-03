// @vitest-environment jsdom
/*
 * K4.2 — deactivating an agen and changing what they pay used to be instant, unsigned and
 * unannounced. The screen half of the fix: a date the change can be given, and the record
 * of who changed what, on the screen where somebody is about to change it again.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class extends Error {},
  uploadFile: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u-1', role: 'HEAD_OFFICE', fullName: 'HQ' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/resellers',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ResellerRow } from '@/app/resellers/reseller-row';
import type { Reseller, ResellerPriceChange } from '@/lib/reseller';

const reseller: Reseller = {
  customerId: 'c1',
  customerName: 'Budi',
  homeDepotId: 'd1',
  monthlyTargetQty: 100,
  discountPct: 10,
  flatGallonPriceIdr: 0,
  photoUrl: null,
  active: true,
  joinDate: '2026-01-01',
  note: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const change = (over: Partial<ResellerPriceChange> = {}): ResellerPriceChange => ({
  id: 'ch-1',
  customerId: 'c1',
  changedBy: 'staff-1',
  field: 'discountPct',
  oldValue: '10',
  newValue: '5',
  effectiveAt: '2026-09-01T00:00:00.000Z',
  appliedAt: '2026-09-01T01:00:00.000Z',
  createdAt: '2026-08-25T00:00:00.000Z',
  ...over,
});

function renderRow() {
  return render(
    <LocaleProvider>
      <ResellerRow reseller={reseller} roll={undefined} name="Budi" onChanged={vi.fn()} />
    </LocaleProvider>,
  );
}

/** Opens the editor, which is what triggers the history read. */
async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: /ubah|edit/i }));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
}

beforeEach(() => {
  apiMock.get.mockResolvedValue([]);
  apiMock.patch.mockResolvedValue(reseller);
});
afterEach(() => vi.clearAllMocks());

describe('K4.2 · a price change stops being silent', () => {
  it('sends a future effective date instead of applying the change now', async () => {
    renderRow();
    await openEditor();

    fireEvent.change(screen.getByLabelText(/berlaku mulai|effective from/i), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /simpan|save/i }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    const body = apiMock.patch.mock.calls[0]![1];
    expect(body.effectiveAt).toBe(new Date('2026-09-01').toISOString());
  });

  it('omits the date entirely when none was picked, which still means now', async () => {
    renderRow();
    await openEditor();

    fireEvent.click(screen.getByRole('button', { name: /simpan|save/i }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    expect(apiMock.patch.mock.calls[0]![1]).not.toHaveProperty('effectiveAt');
  });

  it('shows who changed what, and marks the ones that have not happened yet', async () => {
    apiMock.get.mockResolvedValue([
      change({ id: 'ch-2', field: 'active', oldValue: 'true', newValue: 'false', appliedAt: null }),
      change(),
    ]);

    renderRow();
    await openEditor();

    // The applied one reads as a plain line...
    expect(await screen.findByText(/10 → 5/)).toBeTruthy();
    // ...and `active` is rendered as words, never as the raw "true"/"false" it is stored as.
    expect(screen.getByText(/aktif → nonaktif|active → inactive/i)).toBeTruthy();
    // Only the unapplied one carries the scheduled marker.
    expect(screen.getAllByText(/dijadwalkan|scheduled/i)).toHaveLength(1);
  });

  it('says the history could not be read rather than showing an empty one', async () => {
    apiMock.get.mockRejectedValue(new Error('down'));

    renderRow();
    await openEditor();

    expect(
      await screen.findByText(/gagal memuat riwayat|could not load the change history/i),
    ).toBeTruthy();
  });

  it('says plainly that nothing has been recorded yet', async () => {
    renderRow();
    await openEditor();

    expect(
      await screen.findByText(/belum ada perubahan harga|no price change has been recorded/i),
    ).toBeTruthy();
  });
});
