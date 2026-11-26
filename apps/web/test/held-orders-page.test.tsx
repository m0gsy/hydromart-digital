// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** HD-14: the "tertahan" list: accepted orders of a held depot wait for a person. */

const { get, patch, role, confirmMock } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), confirmMock: vi.fn(), role: { value: 'KEPALA_DEPOT' } }));

vi.mock('@/lib/api', () => ({ api: { get, patch }, ApiError: class extends Error {} }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: confirmMock }) }));
vi.mock('@/components/require-auth', () => ({ RequireAuth: ({ children }: { children: unknown }) => children }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k), locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'u1', role: role.value }, ready: true }) }));
vi.mock('@/lib/depot-context', () => ({ useDepot: () => ({ depots: [], selected: null, scopedId: 'd-1', ready: true }) }));

import HeldOrdersPage from '@/app/dashboard/held/page';

const ORDER = { id: 'o1', orderNumber: 'HM-1', status: 'CONFIRMED', recipientName: 'Budi', total: 40000, createdAt: '2026-11-27T03:00:00.000Z' };

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  patch.mockResolvedValue({});
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  role.value = 'KEPALA_DEPOT';
});

describe('held orders page', () => {
  it('refuses a role without the capability', () => {
    role.value = 'COURIER';
    render(<HeldOrdersPage />);
    expect(screen.getByText('dashB.quality.gateTitle')).toBeTruthy();
  });

  it('says so when nothing is held', async () => {
    get.mockResolvedValue([]);
    render(<HeldOrdersPage />);
    expect(await screen.findByText('dashB.held.empty')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/orders/api/v1/orders/manage/held?depotId=d-1', true);
  });

  it('cancels and refunds through the ordinary status path with the reason "quality hold"', async () => {
    get.mockResolvedValue([ORDER]);
    render(<HeldOrdersPage />);
    await userEvent.click(await screen.findByText('dashB.held.cancelRefund'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/orders/api/v1/orders/o1/status', { status: 'CANCELLED', note: 'quality hold' }, true));
  });

  it('does nothing when the person declines, and shows the error when the cancel fails', async () => {
    get.mockResolvedValue([ORDER]);
    confirmMock.mockResolvedValue(false);
    render(<HeldOrdersPage />);
    await userEvent.click(await screen.findByText('dashB.held.cancelRefund'));
    expect(patch).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    confirmMock.mockResolvedValue(true);
    patch.mockRejectedValue(new Error('boom'));
    await userEvent.click(screen.getByText('dashB.held.cancelRefund'));
    expect(await screen.findByText('dashB.held.cancelError')).toBeTruthy();
  });
});
