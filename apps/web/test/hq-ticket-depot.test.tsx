// @vitest-environment jsdom
//
// CA-2-58 — head office's end of a complaint that used to belong to nobody.
//
// A support ticket could not name a depot at all. So the one question this queue exists to
// answer — which depot is this complaint against — could not be asked, and a complaint
// mirrored from a depot arrived looking exactly like one typed at head office.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, put: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
/*
 * The depots come from the network read the page makes — `getCached(depots.manage)` —
 * and NOT from a mocked `useDepot`. This file used to mock `useDepot`, and that mock is
 * the reason it stayed green while the real page threw "useDepot must be used within
 * <DepotProvider>" on every visit: /hq mounts no DepotProvider, so the one call the mock
 * stood in for was the one call that could not work.
 */
const DEPOTS = {
  items: [
    { id: 'd-1', code: 'JKT-01', name: 'Depot Cibubur' },
    { id: 'd-2', code: 'JKT-02', name: 'Depot Kemang' },
  ],
  total: 2,
  page: 1,
  limit: 100,
};
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/tickets',
  useSearchParams: () => new URLSearchParams(),
}));

import HqTicketsPage from '@/app/hq/tickets/page';

/**
 * The depot's name is on screen twice over: once as a chip on the ticket, once as an
 * option in the filter. Only the chip says "this complaint is about that depot", so the
 * assertions below have to mean the chip and not the dropdown.
 */
const chips = (text: string) =>
  screen.queryAllByText(text).filter((el) => el.tagName !== 'OPTION');

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 'tkt-1',
  subject: 'Galon bocor saat diterima',
  customerRef: '081234567890',
  customerPhone: '081234567890',
  orderRef: null,
  depotRef: 'd-1',
  priority: 'MEDIUM',
  status: 'OPEN',
  assigneeId: null,
  createdAt: '2026-09-09T02:00:00.000Z',
  messages: [],
  ...over,
});

beforeEach(() => {
  toast.mockReset();
  post.mockReset().mockResolvedValue({});
  get.mockReset().mockResolvedValue([ticket()]);
  getCached.mockReset().mockResolvedValue(DEPOTS);
});
afterEach(() => vi.clearAllMocks());

describe('CA-2-58 · head office can see which depot a complaint is about', () => {
  it('names the depot rather than printing its uuid', async () => {
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());
    expect(chips('Depot Cibubur')).toHaveLength(1);
    expect(screen.queryByText('d-1')).toBeNull();
  });

  it('falls back to the id when the depot is one this admin cannot see', async () => {
    // A ticket can name a depot that is not in this account's list — a closed depot, or a
    // scope that has since changed. Printing nothing there would hide the link entirely.
    get.mockResolvedValue([ticket({ depotRef: 'd-99' })]);
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());
    expect(chips('d-99')).toHaveLength(1);
  });

  it('says nothing about a depot on a complaint that is about none', async () => {
    get.mockResolvedValue([ticket({ depotRef: null })]);
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());
    expect(chips('Depot Cibubur')).toHaveLength(0);
  });

  it('asks the server for one depot when the queue is filtered to it', async () => {
    const user = userEvent.setup();
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());

    await user.selectOptions(screen.getByLabelText('hq.tickets.depotFilter'), 'd-2');

    await waitFor(() =>
      expect(get.mock.calls.some((c) => String(c[0]).includes('depotRef=d-2'))).toBe(true),
    );
  });

  it('drops the filter again, rather than leaving the queue silently narrowed', async () => {
    const user = userEvent.setup();
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());
    const select = screen.getByLabelText('hq.tickets.depotFilter');

    await user.selectOptions(select, 'd-2');
    await waitFor(() =>
      expect(get.mock.calls.some((c) => String(c[0]).includes('depotRef=d-2'))).toBe(true),
    );
    get.mockClear();
    await user.selectOptions(select, '');

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.every((c) => !String(c[0]).includes('depotRef'))).toBe(true);
  });

  /*
   * The rest of this queue was never covered either, and it is the queue depot complaints
   * now land in: an unread complaint and an unassigned one look the same from outside.
   */
  it('assigns a ticket to whoever is looking at it, then stops offering to', async () => {
    const user = userEvent.setup();
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'hq.tickets.assign' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('/tickets/tkt-1/assign');
  });

  it('offers no assign button on a ticket somebody already took', async () => {
    get.mockResolvedValue([ticket({ assigneeId: 'staff-7' })]);
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'hq.tickets.assign' })).toBeNull();
  });

  it('resolves a ticket and re-reads the queue rather than trusting its own copy', async () => {
    const user = userEvent.setup();
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());
    const readsBefore = get.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'hq.tickets.resolve' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('/tickets/tkt-1/resolve');
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('says so when a resolve is refused, instead of looking like it worked', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('boom'));
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'hq.tickets.resolve' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('hq.tickets.saveError', 'error'));
  });

  it('narrows the queue by status, which is the filter the chips promise', async () => {
    const user = userEvent.setup();
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText(/Galon bocor/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'hq.tickets.status.RESOLVED' }));
    await waitFor(() =>
      expect(get.mock.calls.some((c) => String(c[0]).includes('status=RESOLVED'))).toBe(true),
    );
  });

  it('shows an empty queue as empty, not as a failure', async () => {
    get.mockResolvedValue([]);
    render(<HqTicketsPage />);
    expect(await screen.findByText('hq.tickets.empty')).toBeTruthy();
  });

  it('refuses to open a ticket that names nobody to answer', async () => {
    // Every field but the order reference is required: a complaint with no number and no
    // name is a row head office can do nothing with.
    const user = userEvent.setup();
    render(<HqTicketsPage />);
    await user.click(await screen.findByRole('button', { name: 'hq.tickets.newTicket' }));

    await user.type(
      screen.getByPlaceholderText('hq.tickets.subjectPlaceholder'),
      'Galon bocor',
    );
    await user.click(screen.getByRole('button', { name: 'hq.tickets.send' }));
    expect(post).not.toHaveBeenCalled();
  });
});
