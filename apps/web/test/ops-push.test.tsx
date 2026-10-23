// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Staff phones were never registered for push: `requestPushOnce` was called for customers
 * and couriers only, so a depot alert found no token for a depot head or manager. These pin
 * the registration trigger and the settings switch that backs it up.
 */
const { requestPushOnce, getPushState, subscribeToPush, unsubscribeFromPush, auth } = vi.hoisted(
  () => ({
    requestPushOnce: vi.fn(async () => {}),
    getPushState: vi.fn(),
    subscribeToPush: vi.fn(),
    unsubscribeFromPush: vi.fn(),
    auth: { customer: { id: 'u-1', role: 'KEPALA_DEPOT' } as { id: string; role: string } | null },
  }),
);

vi.mock('@/lib/push', () => ({
  requestPushOnce,
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: auth.customer }) }));

import { ToastProvider } from '@/components/toast';
import { DevicePushRow, OpsPushPrompt } from '@/components/dashboard/ops-push';
import { LocaleProvider } from '@/lib/locale-context';

beforeEach(() => {
  requestPushOnce.mockClear();
  getPushState.mockReset().mockResolvedValue('unsubscribed');
  subscribeToPush.mockReset().mockResolvedValue('subscribed');
  unsubscribeFromPush.mockReset().mockResolvedValue('unsubscribed');
  auth.customer = { id: 'u-1', role: 'KEPALA_DEPOT' };
});

describe('OpsPushPrompt', () => {
  it('registers the phone once a staff account is signed in', () => {
    render(<OpsPushPrompt />);
    expect(requestPushOnce).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different account on the same phone', () => {
    const { rerender } = render(<OpsPushPrompt />);
    auth.customer = { id: 'u-2', role: 'MANAGER' };
    rerender(<OpsPushPrompt />);
    expect(requestPushOnce).toHaveBeenCalledTimes(2);
  });

  it('does nothing before sign-in', () => {
    auth.customer = null;
    render(<OpsPushPrompt />);
    expect(requestPushOnce).not.toHaveBeenCalled();
  });

  it('does not ask a customer who wandered onto /dashboard', () => {
    auth.customer = { id: 'c-1', role: 'CUSTOMER' };
    render(<OpsPushPrompt />);
    expect(requestPushOnce).not.toHaveBeenCalled();
  });
});

function renderRow() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <DevicePushRow />
      </ToastProvider>
    </LocaleProvider>,
  );
}

describe('DevicePushRow', () => {
  it('shows the real device state and turns push on', async () => {
    renderRow();
    const sw = await screen.findByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(subscribeToPush).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  });

  it('turns push off', async () => {
    getPushState.mockResolvedValue('subscribed');
    renderRow();
    const sw = await screen.findByRole('switch');
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(sw);
    expect(unsubscribeFromPush).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
  });

  it('does not read as on when the OS permission is refused', async () => {
    subscribeToPush.mockResolvedValue('denied');
    renderRow();
    const sw = await screen.findByRole('switch');
    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(await screen.findByText(/diblokir|blocked/i)).toBeInTheDocument();
  });

  it('rolls back when registering throws', async () => {
    subscribeToPush.mockRejectedValue(new Error('offline'));
    renderRow();
    const sw = await screen.findByRole('switch');
    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(await screen.findByText(/gagal|could not/i)).toBeInTheDocument();
  });

  it('renders nothing where push cannot work', async () => {
    getPushState.mockResolvedValue('unsupported');
    renderRow();
    await waitFor(() => expect(getPushState).toHaveBeenCalled());
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('renders nothing when the state read itself fails', async () => {
    getPushState.mockRejectedValue(new Error('plugin gone'));
    renderRow();
    await waitFor(() => expect(getPushState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
