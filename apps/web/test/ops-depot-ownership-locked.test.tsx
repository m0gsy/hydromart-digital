// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Owner decision 2026-11-21: who owns a depot is head office's (PUT …/owners). The ops console
 * edit form offered a depot's manager the ownership select and the owners editor anyway, and
 * every change there was refused by the server.
 */

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));
const auth = vi.hoisted(() => ({ role: 'MANAGER' }));

const DEPOT = {
  id: 'dep-1',
  code: 'DPT-01',
  name: 'Depot Menteng',
  ownershipType: 'WARALABA',
  ownerId: 'own-1',
  owners: [{ ownerId: 'own-1', sharePct: 100, isPrimary: true }],
  address: 'Jl. Menteng 1',
  city: 'Jakarta',
  province: 'DKI Jakarta',
  lat: -6.1944,
  lng: 106.8412,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  contactPhone: null,
  paymentBankName: null,
  paymentBankAccountNumber: null,
  paymentBankAccountHolder: null,
  paymentQrisImageUrl: null,
  operatingHours: {},
  holidays: [],
  active: true,
  updatedAt: '2026-11-21T01:00:00.000Z',
};

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async () => ({ items: [], total: 0 })),
    getCached: vi.fn(async () => DEPOT),
    patch,
    post: vi.fn(),
  },
  uploadFile: vi.fn(),
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/all-depots', () => ({ fetchAllDepots: async () => [DEPOT] }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role, assignedDepotId: 'dep-1' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/depots',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import DepotsPage from '@/app/dashboard/depots/page';

afterEach(() => {
  auth.role = 'MANAGER';
  vi.clearAllMocks();
});

async function openEditor() {
  render(
    <LocaleProvider>
      <DepotsPage />
    </LocaleProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /^(Ubah|Edit)$/ }));
}

describe('ops depot form: ownership is head office’s', () => {
  it('shows a manager the ownership, read-only, and no owners editor', async () => {
    await openEditor();
    const select = document.querySelector<HTMLSelectElement>('#d-own');
    expect(select?.disabled).toBe(true);
    expect(select?.value).toBe('WARALABA');
    expect(screen.getByText(/Diubah oleh kantor pusat|Changed by head office/)).toBeTruthy();
    expect(document.querySelector('#d-owner-ops-0')).toBeNull();
  });

  it('a manager saving the rest of the depot sends the ownership it read, unchanged', async () => {
    patch.mockResolvedValue({});
    await openEditor();
    await userEvent.click(screen.getByRole('button', { name: /Simpan perubahan|Save changes/ }));
    await vi.waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        '/depots/api/v1/depots/dep-1',
        expect.objectContaining({
          ownershipType: 'WARALABA',
          owners: [{ ownerId: 'own-1', sharePct: 100, isPrimary: true }],
        }),
        true,
      ),
    );
  });

  it('leaves it editable for super admin, who holds head office’s capability too', async () => {
    auth.role = 'SUPER_ADMIN';
    await openEditor();
    expect(document.querySelector<HTMLSelectElement>('#d-own')?.disabled).toBe(false);
    expect(screen.queryByText(/Diubah oleh kantor pusat|Changed by head office/)).toBeNull();
  });
});
