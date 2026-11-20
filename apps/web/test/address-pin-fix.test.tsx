// @vitest-environment jsdom
/**
 * P2-2. The depot's customer card shows where the door is and lets staff with the write
 * capability fix it — coordinates or a Maps link, read by the server's own parser.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, patch } };
});

import { ApiError } from '@/lib/api';
import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import { AddressPinFix } from '@/components/dashboard/address-pin-fix';
import type { DepotCustomerAddress } from '@/lib/types';

afterEach(() => vi.clearAllMocks());

const address: DepotCustomerAddress = {
  id: 'a-1',
  label: 'Rumah',
  recipientName: 'Budi',
  phone: '0812',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: '',
  latitude: -6.9147,
  longitude: 107.6098,
  isPrimary: true,
  inRadius: true,
  distanceKm: 1.2,
  updatedAt: '2026-11-20T01:00:00.000Z',
};

const draw = (over: Partial<DepotCustomerAddress> = {}, canFix = true, onSaved = vi.fn()) =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <AddressPinFix
          customerId="c-1"
          depotId="d-1"
          address={{ ...address, ...over }}
          canFix={canFix}
          onSaved={onSaved}
        />
      </ToastProvider>
    </LocaleProvider>,
  );

describe('AddressPinFix', () => {
  it('links the stored pin to the map, and offers no fix to a reader', () => {
    draw({}, false);
    const link = screen.getByText('Lihat peta').closest('a');
    expect(link?.getAttribute('href')).toContain('query=-6.9147,107.6098');
    expect(screen.queryByText('Betulkan pin')).toBeNull();
  });

  it('says plainly when there is no pin', () => {
    draw({ latitude: null, longitude: null });
    expect(screen.getByText('Belum ada pin')).toBeTruthy();
  });

  it('sends the pasted link for this depot and reloads the card', async () => {
    patch.mockResolvedValue({});
    const onSaved = vi.fn();
    draw({}, true, onSaved);
    fireEvent.click(screen.getByText('Betulkan pin'));
    fireEvent.change(screen.getByLabelText('Tempel koordinat atau link Google Maps'), {
      target: { value: '  -6.91, 107.61 ' },
    });
    fireEvent.click(screen.getByText('Simpan pin'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith(
      expect.stringContaining('/customers/c-1/addresses/a-1/location'),
      { depotId: 'd-1', location: '-6.91, 107.61', seenUpdatedAt: '2026-11-20T01:00:00.000Z' },
      true,
    );
  });

  it("shows the server's own words when it cannot read the link", async () => {
    patch.mockRejectedValue(new ApiError(400, 'Link pendek tidak bisa dibaca.'));
    draw();
    fireEvent.click(screen.getByText('Betulkan pin'));
    fireEvent.change(screen.getByLabelText('Tempel koordinat atau link Google Maps'), {
      target: { value: 'https://maps.app.goo.gl/x' },
    });
    fireEvent.click(screen.getByText('Simpan pin'));
    expect((await screen.findByRole('alert')).textContent).toBe('Link pendek tidak bisa dibaca.');
  });
});
