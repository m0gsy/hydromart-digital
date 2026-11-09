// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true }),
}));

import CampaignsPage from '@/app/dashboard/campaigns/page';
import { ConfirmProvider } from '@/components/confirm';
import { endpoints } from '@/lib/endpoints';
import { id as idDict } from '@/lib/dictionaries/id';
import { LocaleProvider } from '@/lib/locale-context';

const C = idDict.dashboard.campaigns;

const campaign = (id: string, name: string, status: string) => ({
  id,
  name,
  channel: 'IN_APP',
  status,
  totalRecipients: 10,
  sentCount: 4,
  failedCount: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  sentAt: null,
  scheduledFor: null,
});

const draw = () =>
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <CampaignsPage />
      </ConfirmProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  get.mockReset().mockResolvedValue({
    items: [
      campaign('c-draft', 'Draf Promo', 'DRAFT'),
      campaign('c-send', 'Sedang Kirim', 'SENDING'),
      campaign('c-done', 'Selesai', 'SENT'),
      campaign('c-gone', 'Dibatalkan', 'CANCELLED'),
      campaign('c-warn', 'Ada Gagal', 'COMPLETED_WITH_FAILURES'),
    ],
    total: 5,
    page: 1,
    limit: 50,
  });
});
afterEach(() => vi.clearAllMocks());

describe('dashboard/campaigns · cancel (CRM-04)', () => {
  it('offers Cancel only on a draft or a still-sending campaign', async () => {
    draw();
    await screen.findByText('Draf Promo');
    expect(screen.getAllByRole('button', { name: C.cancelCampaign })).toHaveLength(2);
    // The new states render with their own label.
    expect(screen.getByText('CANCELLED')).toBeTruthy();
    expect(screen.getByText('COMPLETED_WITH_FAILURES')).toBeTruthy();
  });

  it('asks first, then posts the cancel for that campaign and reloads', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Sedang Kirim');
    const [, sendingCancel] = screen.getAllByRole('button', { name: C.cancelCampaign });
    await user.click(sendingCancel!);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: C.cancelCampaign }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(endpoints.crm.cancelCampaign('c-send'), undefined, true),
    );
  });
});
