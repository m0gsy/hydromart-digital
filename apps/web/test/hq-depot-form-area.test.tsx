// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { patch, post } = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { patch, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/hq/owner-select', () => ({ OwnerSelect: () => null }));

import { DepotForm } from '@/components/hq/depot-form';
import { LocaleProvider } from '@/lib/locale-context';
import type { DepotAdmin } from '@/lib/types';

const SQUARE = [
  [
    { lat: -6.2, lng: 106.8 },
    { lat: -6.2, lng: 107 },
    { lat: -6, lng: 107 },
    { lat: -6, lng: 106.8 },
  ],
];

const depot = (over: Partial<DepotAdmin> = {}): DepotAdmin =>
  ({
    id: 'd1',
    code: 'JKT-01',
    name: 'Depot Cikini',
    ownershipType: 'HKP',
    ownerId: null,
    address: 'Jl. Cikini',
    city: 'Jakarta',
    province: 'DKI Jakarta',
    lat: -6.1,
    lng: 106.9,
    serviceRadiusKm: 5,
    deliveryFee: 5000,
    minOrderAmount: null,
    active: true,
    updatedAt: '2026-10-27T01:00:00.000Z',
    ...over,
  }) as DepotAdmin;

const mount = (d: DepotAdmin | null) => {
  render(
    <LocaleProvider>
      <DepotForm depot={d} onDone={vi.fn()} onCancel={vi.fn()} />
    </LocaleProvider>,
  );
};
const box = () => document.getElementById('d-area') as HTMLTextAreaElement;
const save = (label: RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));
const SAVE = /Simpan perubahan/;

beforeEach(() => {
  patch.mockReset().mockResolvedValue({});
  post.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe('the drawn service area in the HQ depot form', () => {
  it('shows the stored area as text, with a drawing', () => {
    mount(depot({ serviceArea: SQUARE }));
    expect(box().value).toBe('-6.2, 106.8\n-6.2, 107\n-6, 107\n-6, 106.8');
    expect(screen.getByRole('img', { name: /Pratinjau/ })).toBeTruthy();
    expect(screen.getByText(/1 poligon, 4 titik/)).toBeTruthy();
  });

  it('sends no area when it was not touched, so it cannot clobber a change made elsewhere', async () => {
    mount(depot({ serviceArea: SQUARE }));
    save(SAVE);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).not.toHaveProperty('serviceArea');
    expect(patch.mock.calls[0]![1]).toMatchObject({ seenUpdatedAt: '2026-10-27T01:00:00.000Z' });
  });

  it('sends the new area once it is edited', async () => {
    mount(depot({ serviceArea: SQUARE }));
    fireEvent.change(box(), { target: { value: '0, 0\n0, 1\n1, 1' } });
    save(SAVE);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1].serviceArea).toEqual([
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 1, lng: 1 },
      ],
    ]);
  });

  it('clears the area with null when the box is emptied', async () => {
    mount(depot({ serviceArea: SQUARE }));
    fireEvent.change(box(), { target: { value: '' } });
    save(SAVE);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1].serviceArea).toBeNull();
  });

  it('does not count reflowed whitespace as an edit', async () => {
    mount(depot({ serviceArea: SQUARE }));
    fireEvent.change(box(), {
      target: { value: '-6.2,106.8\r\n-6.2 ,  107\n-6,107\n-6, 106.8\n\n' },
    });
    save(SAVE);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).not.toHaveProperty('serviceArea');
  });

  it('refuses to save while a line is unreadable, and says which', async () => {
    mount(depot());
    fireEvent.change(box(), { target: { value: '0, 0\n0, 1\nnope' } });
    expect(screen.getAllByText(/baris 3/).length).toBeGreaterThan(0);
    save(SAVE);
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends the area on a new depot only when one was typed', async () => {
    const ids: Record<string, string> = {
      code: 'd-code',
      name: 'd-name',
      address: 'd-addr',
      city: 'd-city',
      province: 'd-prov',
      lat: 'd-lat',
      lng: 'd-lng',
      deliveryFee: 'd-fee',
    };
    const filled: Record<string, string> = {
      code: 'NEW-1',
      name: 'Baru',
      address: 'Jl. A',
      city: 'Bogor',
      province: 'Jawa Barat',
      lat: '-6.5',
      lng: '106.8',
      deliveryFee: '5000',
    };
    mount(null);
    for (const [key, value] of Object.entries(filled)) {
      fireEvent.change(document.getElementById(ids[key]!)!, { target: { value } });
    }
    save(/Buat depot/);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).not.toHaveProperty('serviceArea');

    fireEvent.change(box(), { target: { value: '0, 0\n0, 1\n1, 1' } });
    save(/Buat depot/);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]![1].serviceArea).toHaveLength(1);
  });
});
