// @vitest-environment jsdom
/**
 * P3-4. Moving a depot or shrinking its radius re-routes its subscribers on the next sweep, so
 * the save says how many first and goes through on the second press. A warning, never a
 * lock: a preview that moves nobody, or that cannot be read, saves on the first press.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { patch, post } = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { patch, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/hq/owner-select', () => ({ OwnerSelect: () => null }));

import { DepotForm } from '@/components/hq/depot-form';
import { movesDepot, useRerouteGate } from '@/components/dashboard/reroute-warning';
import { LocaleProvider } from '@/lib/locale-context';
import type { DepotAdmin } from '@/lib/types';

const depot = {
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
} as unknown as DepotAdmin;

const mount = () =>
  render(
    <LocaleProvider>
      <DepotForm depot={depot} onDone={vi.fn()} onCancel={vi.fn()} />
    </LocaleProvider>,
  );
const radius = (v: string) =>
  fireEvent.change(document.getElementById('d-rad') as HTMLInputElement, {
    target: { value: v },
  });
const save = () => fireEvent.click(screen.getByRole('button', { name: /Simpan perubahan/ }));

beforeEach(() => {
  patch.mockReset().mockResolvedValue({});
  post.mockReset();
});
afterEach(cleanup);

describe('a depot edit that re-routes subscribers', () => {
  it('says how many move on the first press, and saves on the second', async () => {
    post.mockResolvedValue({ affected: 4, unserved: 1, moves: [] });
    mount();
    radius('3');
    save();

    expect(await screen.findByText(/4 langganan aktif terdampak/)).toBeTruthy();
    expect(screen.getByText(/1 tak terjangkau depot lain/)).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/subscriptions/admin/reroute-preview'),
      { depotId: 'd1', lat: -6.1, lng: 106.9, serviceRadiusKm: 3 },
      true,
    );
    expect(patch).not.toHaveBeenCalled();

    save();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('asks again after the warning when the edit changes', async () => {
    post.mockResolvedValue({ affected: 2, unserved: 0, moves: [] });
    mount();
    radius('3');
    save();
    await screen.findByText(/2 langganan aktif terdampak/);
    radius('2');
    expect(screen.queryByText(/2 langganan aktif terdampak/)).toBeNull();
    save();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    ['moves nobody', () => post.mockResolvedValue({ affected: 0, unserved: 0, moves: [] })],
    ['cannot be read', () => post.mockRejectedValue(new Error('down'))],
  ])('saves on the first press when the preview %s', async (_name, arrange) => {
    arrange();
    mount();
    radius('3');
    save();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  });

  it('runs no preview for an edit that neither moves the depot nor changes its radius', async () => {
    mount();
    save();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(post).not.toHaveBeenCalled();
  });
});

describe('movesDepot', () => {
  const before = { lat: -6.1, lng: 106.9, serviceRadiusKm: 5 };
  it('is a move, a shift or a new radius — nothing else', () => {
    expect(movesDepot(before, { lat: -6.1, lng: 106.9, serviceRadiusKm: 5 })).toBe(false);
    expect(movesDepot(before, { lat: -6.1, lng: 106.9 })).toBe(false);
    expect(movesDepot(before, { lat: -6.2, lng: 106.9 })).toBe(true);
    expect(movesDepot(before, { lat: -6.1, lng: 107, serviceRadiusKm: 5 })).toBe(true);
    expect(movesDepot(before, { lat: -6.1, lng: 106.9, serviceRadiusKm: 4 })).toBe(true);
  });
});

describe('a redrawn area', () => {
  it('is previewed with the area it would save', async () => {
    post.mockResolvedValue({ affected: 3, unserved: 3, moves: [] });
    mount();
    fireEvent.change(document.getElementById('d-area') as HTMLTextAreaElement, {
      target: { value: ['-6.2, 106.8', '-6.2, 107', '-6, 107'].join('\n') },
    });
    save();
    expect(await screen.findByText(/3 langganan aktif terdampak/)).toBeTruthy();
    expect(post.mock.calls[0]![1]).toMatchObject({
      depotId: 'd1',
      serviceArea: [
        [
          { lat: -6.2, lng: 106.8 },
          { lat: -6.2, lng: 107 },
          { lat: -6, lng: 107 },
        ],
      ],
    });
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('useRerouteGate', () => {
  it('asks once per change: the same change goes ahead, a different one or a reset asks again', async () => {
    post.mockResolvedValue({ affected: 1, unserved: 0, moves: [] });
    const { result } = renderHook(() => useRerouteGate());
    const off = { depotId: 'd1', active: false as const };

    await act(async () => expect(await result.current.check(off)).toBe(false));
    expect(result.current.impact?.affected).toBe(1);
    await act(async () => expect(await result.current.check(off)).toBe(true));
    expect(post).toHaveBeenCalledTimes(1);

    await act(async () => expect(await result.current.check({ ...off, active: undefined } as never)).toBe(false));
    act(() => result.current.reset());
    expect(result.current.impact).toBeNull();
    await act(async () => expect(await result.current.check(off)).toBe(false));
    expect(post).toHaveBeenCalledTimes(3);
  });
});
