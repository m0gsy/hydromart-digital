// @vitest-environment jsdom
/**
 * FR-052 — the customer moves their own order to another delivery slot.
 *
 * The screen only asks: the server decides whether the move is allowed. What this pins is what
 * it ASKS: the real instant of the chosen slot on the chosen Jakarta day, to the right route.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, toast } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, post } };
});
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));

import { RescheduleSheet } from '@/components/order/reschedule-sheet';
import { ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { Order } from '@/lib/types';

const order = { id: 'o-1', depotId: 'd-1' } as unknown as Order;

function show(onDone = vi.fn(), onClose = vi.fn()) {
  render(<RescheduleSheet order={order} onClose={onClose} onDone={onDone} />);
  return { onDone, onClose };
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({
    slots: ['09.00-11.00', '11.00-13.00'],
    expressEnabled: false,
    expressFee: 0,
    expressEtaMinMinutes: 0,
    expressEtaMaxMinutes: 0,
  });
  post.mockReset().mockResolvedValue({});
  toast.mockReset();
});

describe('reschedule sheet', () => {
  it('reads the slots of the order own depot', async () => {
    show();
    await waitFor(() => expect(screen.getByText('11.00-13.00')).toBeTruthy());
    expect(get).toHaveBeenCalledWith(endpoints.orders.deliveryOptions('d-1'));
  });

  it('posts the real instant of the chosen slot to the reschedule route, then finishes', async () => {
    const { onDone } = show();
    await waitFor(() => expect(screen.getByText('11.00-13.00')).toBeTruthy());
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1]!, { target: { value: '11.00-13.00' } });
    fireEvent.click(screen.getByText('order.detail.rescheduleConfirm'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body, authed] = post.mock.calls[0]!;
    expect(url).toBe(endpoints.orders.reschedule('o-1'));
    expect(authed).toBe(true);
    // 11:00 Jakarta is 04:00 UTC, on some day within the next four.
    expect(body.scheduledFor).toMatch(/^\d{4}-\d{2}-\d{2}T04:00:00\.000Z$/);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith('order.toast.rescheduled');
  });

  it("shows the server's refusal and does not finish", async () => {
    post.mockRejectedValue(
      new ApiError(409, 'Jadwal tidak bisa diubah kurang dari 2 jam sebelum jam antar.'),
    );
    const { onDone } = show();
    await waitFor(() => expect(screen.getByText('09.00-11.00')).toBeTruthy());
    fireEvent.click(screen.getByText('order.detail.rescheduleConfirm'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/2 jam/));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says so when the depot has no slots, and offers nothing to save', async () => {
    get.mockResolvedValue({
      slots: [],
      expressEnabled: false,
      expressFee: 0,
      expressEtaMinMinutes: 0,
      expressEtaMaxMinutes: 0,
    });
    show();
    await waitFor(() => expect(screen.getByText('order.detail.rescheduleNoSlots')).toBeTruthy());
    expect(
      (screen.getByText('order.detail.rescheduleConfirm').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
