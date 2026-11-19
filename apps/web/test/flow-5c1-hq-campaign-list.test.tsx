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
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import HqCampaignBuilderPage from '@/app/hq/campaigns/page';
import { ConfirmProvider } from '@/components/confirm';
import { endpoints } from '@/lib/endpoints';
import { id as idDict } from '@/lib/dictionaries/id';
import { LocaleProvider } from '@/lib/locale-context';

const H = idDict.hq.campaigns;
const C = idDict.dashboard.campaigns;
const LIST = endpoints.crm.campaigns({ page: 1, limit: 50 });

const campaign = (
  id: string,
  name: string,
  status: string,
  scheduledFor: string | null = null,
) => ({
  id,
  name,
  channel: 'IN_APP',
  status,
  totalRecipients: 10,
  sentCount: 4,
  failedCount: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  sentAt: null,
  scheduledFor,
});

const listReads = () => get.mock.calls.filter(([url]) => url === LIST).length;

const draw = () =>
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <HqCampaignBuilderPage />
      </ConfirmProvider>
    </LocaleProvider>,
  );

async function sendNow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: H.next }));
  await user.type(screen.getByLabelText(H.nameLabel), 'Promo Akhir Bulan');
  await user.type(screen.getByLabelText(H.messageLabel), 'Diskon 10%');
  await user.click(screen.getByRole('button', { name: H.next }));
  await user.click(screen.getByRole('button', { name: H.sendNow }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(
    within(dialog).getByRole('button', { name: idDict.hrFix.confirmGap.broadcastConfirm }),
  );
}

beforeEach(() => {
  post
    .mockReset()
    .mockImplementation((url: string) =>
      Promise.resolve(url === endpoints.crm.createCampaign ? { id: 'c-new' } : {}),
    );
  get.mockReset().mockImplementation((url: string) =>
    Promise.resolve(
      url === LIST
        ? {
            items: [
              campaign('c-send', 'Sedang Kirim', 'SENDING'),
              campaign('c-done', 'Selesai', 'SENT'),
              campaign('c-later', 'Minggu Depan', 'SENDING', '2026-11-26T03:00:00.000Z'),
            ],
            total: 3,
            page: 1,
            limit: 50,
          }
        : { count: 12 },
    ),
  );
});
afterEach(() => vi.clearAllMocks());

describe('hq/campaigns · the list of what was sent (flow 5c)', () => {
  it('shows sent and running campaigns under the builder, with Cancel on the running one', async () => {
    draw();
    expect(screen.getByRole('heading', { name: H.listTitle })).toBeTruthy();
    await screen.findByText('Sedang Kirim');
    expect(screen.getByText('Selesai')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: C.cancelCampaign })).toHaveLength(2);
  });

  it('says when a scheduled campaign goes out: claimed, it reads SENDING like one going out now', async () => {
    draw();
    await screen.findByText('Minggu Depan');
    expect(screen.getAllByText(/terjadwal/)).toHaveLength(1);
  });

  it('reads the list again once a campaign is sent from the builder', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('Sedang Kirim');
    expect(listReads()).toBe(1);
    await sendNow(user);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(endpoints.crm.sendCampaign('c-new'), undefined, true),
    );
    await waitFor(() => expect(listReads()).toBe(2));
  });

  it('reads it again when the send fails too: the draft it created is listed, sendable from there', async () => {
    post.mockImplementation((url: string) =>
      url === endpoints.crm.createCampaign
        ? Promise.resolve({ id: 'c-new' })
        : Promise.reject(new Error('down')),
    );
    const user = userEvent.setup();
    draw();
    await screen.findByText('Sedang Kirim');
    await sendNow(user);
    await waitFor(() => expect(listReads()).toBe(2));
  });
});
