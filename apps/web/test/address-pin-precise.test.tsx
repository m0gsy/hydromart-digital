// @vitest-environment jsdom
/**
 * Owner decision 2026-11-20: the customer app takes PRECISE location for the address pin.
 * An approximate fix is hundreds of metres to kilometres off, and the pin is where the
 * courier drives to — so "Gunakan lokasi saya" on an address asks for a precise fix.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get, post, currentPosition } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  currentPosition: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch: vi.fn() } };
});
vi.mock('@/lib/geo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/geo')>('@/lib/geo');
  return { ...actual, currentPosition };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/addresses',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import AddressesPage from '@/app/addresses/page';

afterEach(() => vi.clearAllMocks());

describe('the address pin', () => {
  it('asks for a GPS pin and says how accurate it is', async () => {
    get.mockResolvedValue([]);
    currentPosition.mockResolvedValue({
      coords: { latitude: -6.2001, longitude: 106.8001, accuracy: 12 },
      timestamp: 0,
    });
    render(
      <LocaleProvider>
        <ToastProvider>
          <AddressesPage />
        </ToastProvider>
      </LocaleProvider>,
    );

    const add = await screen.findAllByRole('button', { name: /tambah alamat/i });
    await userEvent.click(add[0]!);
    await userEvent.click(await screen.findByRole('button', { name: /gunakan lokasi saya/i }));

    await waitFor(() => expect(currentPosition).toHaveBeenCalledWith({ pin: true }));
    // The accuracy is said, so a fix that fell back to the approximate provider is not silent.
    expect(await screen.findByText(/±12 m/)).toBeTruthy();
  });

  it('saves the fix with how good it was, and flags a rough stored one on the list', async () => {
    get.mockResolvedValue([
      {
        id: 'a-1',
        label: 'Kantor',
        recipientName: 'Budi',
        phone: '0812',
        addressLine: 'Jl. Asia Afrika 1',
        city: 'Bandung',
        postalCode: null,
        latitude: -6.92,
        longitude: 107.6,
        pinAccuracyM: 450,
        pinSource: 'GPS',
        notes: null,
        isPrimary: true,
      },
    ]);
    post.mockResolvedValue({});
    currentPosition.mockResolvedValue({
      coords: { latitude: -6.2001, longitude: 106.8001, accuracy: 12.4 },
      timestamp: 0,
    });
    render(
      <LocaleProvider>
        <ToastProvider>
          <AddressesPage />
        </ToastProvider>
      </LocaleProvider>,
    );

    // 450 m is too rough for a courier: said on the list, where it can be fixed.
    expect(await screen.findByText(/±450 m/)).toBeTruthy();

    const add = await screen.findAllByRole('button', { name: /tambah alamat/i });
    await userEvent.click(add[0]!);
    await userEvent.type(screen.getByLabelText('Label'), 'Rumah');
    await userEvent.type(screen.getByLabelText('Nama penerima'), 'Budi');
    await userEvent.type(screen.getByLabelText('Nomor telepon'), '0812');
    await userEvent.type(screen.getByLabelText('Alamat'), 'Jl. Merdeka 10');
    await userEvent.type(screen.getByLabelText('Kota'), 'Bandung');
    await userEvent.click(await screen.findByRole('button', { name: /gunakan lokasi saya/i }));
    await screen.findByText(/±12 m/);
    await userEvent.click(screen.getByRole('button', { name: /^simpan$/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/addresses'),
        expect.objectContaining({ latitude: -6.2001, pinSource: 'GPS', pinAccuracyM: 12 }),
        true,
      ),
    );
  });
});
