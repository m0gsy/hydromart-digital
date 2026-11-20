// @vitest-environment jsdom
/**
 * Courier self-claim (fixed 2026-11-20, still OFF unless a depot turns it on).
 *
 * The list asked for CONFIRMED orders, but the only state a courier can be handed is
 * PREPARING (PREPARING → DRIVER_ASSIGNED), so every claim from this list was refused.
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn() } };
});

import { LocaleProvider } from '@/lib/locale-context';
import { ClaimableOrders } from '@/components/driver/claimable-orders';

afterEach(() => vi.clearAllMocks());

describe('the claimable list', () => {
  it('lists the PREPARING orders of the courier depot', async () => {
    get.mockImplementation(async (path: string) =>
      String(path).includes('/settings')
        ? { courierSelfClaimEnabled: 1, courierSelfClaimWaitMinutes: 10 }
        : { items: [], total: 0, page: 1, limit: 20 },
    );
    render(<ClaimableOrders depotId="d-1" onClaimed={vi.fn()} />, { wrapper: LocaleProvider });

    await waitFor(() =>
      expect(get.mock.calls.some(([p]) => String(p).includes('/orders/'))).toBe(true),
    );
    const url = String(get.mock.calls.find(([p]) => String(p).includes('/orders/'))![0]);
    expect(new URL(url, 'http://x').searchParams.get('status')).toBe('PREPARING');
  });
});
