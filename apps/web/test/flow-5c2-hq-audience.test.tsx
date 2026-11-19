// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, del, replace, who } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  replace: vi.fn(),
  who: { role: 'SUPER_ADMIN' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

import HqCampaignBuilderPage from '@/app/hq/campaigns/page';
import HqBroadcastPage from '@/app/hq/broadcast/page';
import HqSegmentFormPage from '@/app/hq/forms/segment/page';
import { ConfirmProvider } from '@/components/confirm';
import { endpoints } from '@/lib/endpoints';
import { id as idDict } from '@/lib/dictionaries/id';
import { LocaleProvider } from '@/lib/locale-context';

const H = idDict.hq.campaigns;
const A = idDict.hq.campaigns.audience;
const LIST = endpoints.crm.campaigns({ page: 1, limit: 50 });
const DEPOTS = endpoints.depots.browse({ limit: 100 });
const ADMIN_DEPOTS = endpoints.depots.manage({ limit: 100 });
const GALAXY = '0b7c2f0e-1111-4c1a-9a51-5f0c3c0d0001';
const LAPSED = {
  id: 'sg-1',
  name: 'Lama tidak order',
  conditions: { recencyDays: 45, minOrders: 2 },
  createdBy: 'u1',
  createdAt: '2026-11-01T00:00:00.000Z',
};

const draw = () =>
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <HqCampaignBuilderPage />
      </ConfirmProvider>
    </LocaleProvider>,
  );

// What the server holds: the POST below adds to it, as the real upsert does.
let stored: (typeof LAPSED)[] = [];

const estimateCalls = () =>
  get.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('segment-estimate'));

beforeEach(() => {
  who.role = 'SUPER_ADMIN';
  stored = [LAPSED];
  replace.mockReset();
  del.mockReset().mockResolvedValue(undefined);
  post.mockReset().mockImplementation((url: string, body: { name: string; conditions: unknown }) =>
    Promise.resolve(
      url === endpoints.crm.createCampaign
        ? { id: 'c-new' }
        : url === endpoints.crm.savedSegments
          ? (stored = [
              ...stored,
              {
                ...LAPSED,
                id: 'sg-2',
                name: body.name,
                conditions: body.conditions as typeof LAPSED.conditions,
              },
            ]).at(-1)
          : {},
    ),
  );
  get
    .mockReset()
    .mockImplementation((url: string) =>
      Promise.resolve(
        url === LIST
          ? { items: [], total: 0, page: 1, limit: 50 }
          : url === endpoints.crm.savedSegments
            ? stored
            : { count: 7 },
      ),
    );
  getCached
    .mockReset()
    .mockImplementation((url: string) =>
      Promise.resolve(
        url === DEPOTS
          ? { items: [{ id: GALAXY, name: 'BKS Galaxy' }], total: 1, page: 1, limit: 100 }
          : null,
      ),
    );
});
afterEach(() => vi.clearAllMocks());

describe('hq/campaigns · the audience step holds the saved and hand-built segments (flow 5c)', () => {
  it('a saved segment sizes the estimate and is the segment the campaign is created with', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: LAPSED.name }));
    await waitFor(() =>
      expect(estimateCalls().some((u) => u.includes('recencyDays=45'))).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: H.next }));
    await user.type(screen.getByLabelText(H.nameLabel), 'Ajak balik');
    await user.type(screen.getByLabelText(H.messageLabel), 'Kami rindu');
    await user.click(screen.getByRole('button', { name: H.next }));
    expect(screen.getByText(LAPSED.name)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: H.sendNow }));
    // A send now cannot be taken back: it asks first, as the broadcast screen did.
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: idDict.hrFix.confirmGap.broadcastConfirm }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        endpoints.crm.createCampaign,
        expect.objectContaining({ segment: { recencyDays: 45, minOrders: 2 } }),
        true,
      ),
    );
  });

  it('builds a segment by hand — activity and a depot — and saves it under a name, then uses it', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: A.custom }));
    await user.type(screen.getByLabelText(A.recency), '30');
    await user.type(screen.getByLabelText(A.minOrders), '3');
    await user.selectOptions(await screen.findByLabelText(A.depot), GALAXY);
    const conditions = { recencyDays: 30, minOrders: 3, depotId: GALAXY };
    await waitFor(() => expect(estimateCalls().some((u) => u.includes(GALAXY))).toBe(true));
    await user.type(screen.getByLabelText(A.saveTitle), 'Galaxy aktif');
    await user.click(screen.getByRole('button', { name: A.save }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        endpoints.crm.savedSegments,
        { name: 'Galaxy aktif', conditions },
        true,
      ),
    );
    // The saved one is picked: its chip is pressed.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Galaxy aktif' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    );
  });

  it('refuses to save a hand-built segment with no condition: that is the first chip', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: A.custom }));
    await user.type(screen.getByLabelText(A.saveTitle), 'Semua');
    await user.click(screen.getByRole('button', { name: A.save }));
    expect(post).not.toHaveBeenCalledWith(endpoints.crm.savedSegments, expect.anything(), true);
  });

  it('removes a saved segment and falls back to everyone', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: LAPSED.name }));
    await user.click(screen.getByRole('button', { name: A.remove }));
    // Shared by everyone at head office: it asks first.
    expect(del).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: A.remove }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(endpoints.crm.savedSegment('sg-1'), true));
    expect(screen.getByRole('button', { name: H.chips.all }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('MARKETING picks a depot from the public directory, never asking for the admin list it cannot read', async () => {
    who.role = 'MARKETING';
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: A.custom }));
    await user.selectOptions(await screen.findByLabelText(A.depot), GALAXY);
    await waitFor(() => expect(estimateCalls().some((u) => u.includes(GALAXY))).toBe(true));
    const asked = [...get.mock.calls, ...getCached.mock.calls].map(([u]) => String(u));
    expect(asked).not.toContain(ADMIN_DEPOTS);
  });

  it('reopens a saved segment as conditions to refine, under its own name', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: LAPSED.name }));
    await user.click(screen.getByRole('button', { name: A.edit }));
    expect((screen.getByLabelText(A.recency) as HTMLInputElement).value).toBe('45');
    expect((screen.getByLabelText(A.minOrders) as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText(A.saveTitle) as HTMLInputElement).value).toBe(LAPSED.name);
  });

  it('will not go on with "Atur sendiri" and nothing usable typed: that would be everyone', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: A.custom }));
    await user.type(screen.getByLabelText(A.recency), '0');
    await user.click(screen.getByRole('button', { name: H.next }));
    expect(screen.queryByLabelText(H.nameLabel)).toBeNull();
  });

  it('sizes a saved segment from what the estimate counts, and creates it with exactly that', async () => {
    stored = [
      {
        ...LAPSED,
        conditions: { recencyDays: 45, minOrders: 2, tier: 'GOLD' } as typeof LAPSED.conditions,
      },
    ];
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: LAPSED.name }));
    await user.click(screen.getByRole('button', { name: H.next }));
    await user.type(screen.getByLabelText(H.nameLabel), 'Ajak balik');
    await user.type(screen.getByLabelText(H.messageLabel), 'Kami rindu');
    await user.click(screen.getByRole('button', { name: H.next }));
    // Scheduled, so no confirm: it can still be cancelled from the list until it is due.
    fireEvent.change(screen.getByLabelText(H.scheduleLabel), {
      target: { value: '2026-12-01T09:00' },
    });
    await user.click(screen.getByRole('button', { name: H.schedule }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        endpoints.crm.createCampaign,
        expect.objectContaining({ segment: { recencyDays: 45, minOrders: 2 } }),
        true,
      ),
    );
  });

  it('a role that may only read campaigns gets the list, not a builder whose send would 403', async () => {
    who.role = 'HEAD_OFFICE';
    draw();
    await waitFor(() => expect(get).toHaveBeenCalledWith(LIST, true));
    expect(screen.getByRole('heading', { name: H.listTitle })).toBeTruthy();
    expect(screen.queryByRole('button', { name: H.next })).toBeNull();
    expect(screen.queryByRole('button', { name: H.sendNow })).toBeNull();
    expect(estimateCalls()).toEqual([]);
  });
});

describe('the screens it replaced', () => {
  it.each([
    ['/hq/broadcast', HqBroadcastPage],
    ['/hq/forms/segment', HqSegmentFormPage],
  ])('%s sends the reader to /hq/campaigns', (_path, Page) => {
    render(<Page />);
    expect(replace).toHaveBeenCalledWith('/hq/campaigns');
  });
});
