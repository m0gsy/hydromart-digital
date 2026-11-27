// @vitest-environment jsdom
//
// AREA-2a: one prospect and its actions. Each action sends the right call with the version it read,
// maps the server's refusals, and is offered only to the capability that may use it.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, post, ask, auth, query, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  ask: vi.fn(),
  auth: { role: 'KEPALA_DEPOT' },
  query: { id: 'p-1' },
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, patch, post }, ApiError: FakeApiError }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'dep-a', code: 'BKS', name: 'Bekasi' },
      { id: 'dep-b', code: 'DPK', name: 'Depok' },
    ],
    selectedId: null,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: ask }) }));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => query.id }));

import ProspectDetailPage from '@/app/dashboard/prospects/detail/page';
import { loadSessionCapabilities } from '@/lib/roles';

const UPDATED = '2026-11-02T01:00:00.000Z';
const detail = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  name: 'Kos Mawar',
  category: 'KOS',
  address: 'Jl. Mawar 1',
  latitude: -6.2,
  longitude: 106.9,
  kecamatanCode: '3275010',
  kelurahanCode: null,
  ownerDepotId: 'dep-a',
  ownerSource: 'AUTO',
  status: 'CONTACTED',
  assignedToId: null,
  source: 'OSM',
  sourceDate: '2026-10-01',
  createdAt: '2026-11-01T01:00:00.000Z',
  updatedAt: UPDATED,
  hasPhone: true,
  phoneE164: '+6281200000001',
  contactName: 'Bu Sari',
  note: 'catatan',
  licence: 'ODbL',
  sourceId: 'osm-1',
  sourceDataset: 'osm',
  customerId: null,
  convertedAt: null,
  lostReason: null,
  assignedAt: null,
  lastActivityAt: '2026-11-02T01:00:00.000Z',
  visits: [{ id: 'v-1', outcome: 'NOT_THERE', distanceM: 41.6, visitedAt: '2026-11-02T03:00:00.000Z' }],
  ...over,
});

function load(row: unknown, staff: unknown = [{ id: 'staff-9', name: 'Sari' }]) {
  get.mockImplementation(async (url: string) => {
    if (url.includes('/assignees')) {
      if (staff instanceof Error) throw staff;
      return staff;
    }
    if (row instanceof Error) throw row;
    return row;
  });
}
const button = (name: string) => screen.findByRole('button', { name });

beforeEach(() => {
  auth.role = 'KEPALA_DEPOT';
  loadSessionCapabilities(null, null);
  query.id = 'p-1';
  for (const m of [get, patch, post, ask]) m.mockReset();
  ask.mockResolvedValue(true);
});
afterEach(cleanup);

describe('prospect detail', () => {
  it('shows the business, tel: link, the Google Maps navigation link, the visits (no coordinates), and the owner', async () => {
    load(detail());
    render(<ProspectDetailPage />);
    expect(await screen.findByText('Kos Mawar')).toBeTruthy();
    expect(screen.getByRole('link', { name: '+6281200000001' }).getAttribute('href')).toBe('tel:+6281200000001');
    const nav = screen.getByRole('link', { name: 'opsFix.prospects.detail.navigate' });
    expect(nav.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=-6.2,106.9');
    expect(nav.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(/BKS - Bekasi/)).toBeTruthy();
    expect(screen.getByText(/opsFix.prospects.detail.distance\|\{"m":42\}/)).toBeTruthy();
  });

  it('never calls the server for a Read-only role (Direksi): the gate card shows instead', async () => {
    auth.role = 'DIREKTUR';
    load(detail());
    render(<ProspectDetailPage />);
    expect(await screen.findByText('opsFix.prospects.gateTitle')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('says "not found" on a 404 without claiming anything about access', async () => {
    load(new FakeApiError(404, 'x'));
    render(<ProspectDetailPage />);
    expect(await screen.findByText('opsFix.prospects.detail.notFound')).toBeTruthy();
  });

  it('offers a retry on a server error', async () => {
    load(new FakeApiError(500, 'x'));
    render(<ProspectDetailPage />);
    expect(await button('common.retry')).toBeTruthy();
  });

  it('changes the stage and sends seenUpdatedAt; LOST needs a reason of 3 to 200 characters', async () => {
    load(detail());
    patch.mockResolvedValue(detail({ status: 'LOST', updatedAt: '2026-11-03T01:00:00.000Z' }));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.status'));
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.statusForm.target'), 'LOST');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    expect(await screen.findByText('opsFix.prospects.statusForm.lostReasonShort')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('opsFix.prospects.statusForm.lostReason'), 'harga');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects/p-1/status');
    expect(patch.mock.calls[0]?.[1]).toEqual({ status: 'LOST', lostReason: 'harga', seenUpdatedAt: UPDATED });
  });

  it('sends a plain stage move without a reason, and shows the new stage', async () => {
    load(detail());
    patch.mockResolvedValue(detail({ status: 'INTERESTED' }));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.status'));
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.statusForm.target'), 'INTERESTED');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[1]).toEqual({ status: 'INTERESTED', seenUpdatedAt: UPDATED });
    expect(await screen.findByText('opsFix.prospects.status.INTERESTED')).toBeTruthy();
  });

  it('on a stale 409 says so and reloads when asked', async () => {
    load(detail());
    patch.mockRejectedValue(new FakeApiError(409, 'server text', 'CUSTOMER_PROSPECT_STALE'));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.status'));
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    expect(await screen.findByText('opsFix.prospects.actions.stale')).toBeTruthy();
    get.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.reload' }));
    await waitFor(() => expect(get).toHaveBeenCalled());
  });

  it('shows the server text for another refusal and a generic one when it has none', async () => {
    load(detail());
    patch.mockRejectedValueOnce(new FakeApiError(409, 'Transisi status tidak diizinkan'));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.status'));
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    expect(await screen.findByText('Transisi status tidak diizinkan')).toBeTruthy();
    patch.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    expect(await screen.findByText('opsFix.prospects.actions.failed')).toBeTruthy();
  });

  it('assigns from the roster (names only), sends the version, and can release', async () => {
    load(detail({ assignedToId: 'staff-9' }));
    patch.mockResolvedValue(detail({ assignedToId: null }));
    render(<ProspectDetailPage />);
    expect(await screen.findByText('Sari')).toBeTruthy();
    await userEvent.click(await button('opsFix.prospects.actions.assign'));
    await userEvent.click(await button('opsFix.prospects.assignForm.unassign'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects/p-1/assign');
    expect(patch.mock.calls[0]?.[1]).toEqual({ assigneeId: null, seenUpdatedAt: UPDATED });
  });

  it('assigns the picked staff member, and says the roster failed when it does', async () => {
    load(detail());
    patch.mockResolvedValue(detail({ assignedToId: 'staff-9' }));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.assign'));
    const save = await button('opsFix.prospects.actions.save');
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.assignForm.staff'), 'staff-9');
    await userEvent.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[1]).toEqual({ assigneeId: 'staff-9', seenUpdatedAt: UPDATED });
    cleanup();
    load(detail(), new FakeApiError(503, 'down'));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.assign'));
    expect(await screen.findByText('opsFix.prospects.assignForm.loadFailed')).toBeTruthy();
  });

  it('shows an empty roster as such', async () => {
    load(detail(), []);
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.assign'));
    expect(await screen.findByText('opsFix.prospects.assignForm.noStaff')).toBeTruthy();
  });

  it('offers the owner-depot change to head office only, with a reason, and sends the version', async () => {
    load(detail());
    render(<ProspectDetailPage />);
    await screen.findByText('Kos Mawar');
    expect(screen.queryByRole('button', { name: 'opsFix.prospects.actions.ownerDepot' })).toBeNull();
    cleanup();

    auth.role = 'HEAD_OFFICE';
    load(detail());
    patch.mockResolvedValue(detail({ ownerDepotId: 'dep-b', ownerSource: 'HQ' }));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.ownerDepot'));
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.ownerForm.depot'), 'dep-b');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    expect(await screen.findByText('opsFix.prospects.ownerForm.reasonShort')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('opsFix.prospects.ownerForm.reason'), 'dekat gudang');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects/p-1/owner-depot');
    expect(patch.mock.calls[0]?.[1]).toEqual({ depotId: 'dep-b', reason: 'dekat gudang', seenUpdatedAt: UPDATED });
  });

  it('sends a row back to the opportunity map (no depot) and handles a stale owner write', async () => {
    auth.role = 'HEAD_OFFICE';
    load(detail());
    patch.mockRejectedValue(new FakeApiError(409, 'x', 'CUSTOMER_PROSPECT_STALE'));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.ownerDepot'));
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.ownerForm.depot'), '');
    await userEvent.type(screen.getByLabelText('opsFix.prospects.ownerForm.reason'), 'luar area');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.actions.save' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ depotId: null });
    expect(await screen.findByText('opsFix.prospects.actions.stale')).toBeTruthy();
  });

  it('converts a prospect with a number without asking for an account', async () => {
    load(detail({ status: 'INTERESTED' }));
    post.mockResolvedValueOnce(detail({ status: 'CONVERTED' }));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.convert'));
    expect(screen.queryByLabelText('opsFix.prospects.convertForm.customerId')).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'opsFix.prospects.actions.convert' })[1] as HTMLElement);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects/p-1/convert');
    expect(post.mock.calls[0]?.[1]).toEqual({});
    expect(await screen.findByText('opsFix.prospects.status.CONVERTED')).toBeTruthy();
  });

  it('asks for the customer account on a phone-less prospect and sends it', async () => {
    load(detail({ status: 'VISITED', phoneE164: null, hasPhone: false }));
    post.mockRejectedValueOnce(new FakeApiError(422, 'Akun pelanggan tidak ditemukan'));
    post.mockResolvedValueOnce(detail({ status: 'CONVERTED' }));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.convert'));
    await userEvent.type(screen.getByLabelText('opsFix.prospects.convertForm.customerId'), 'cust-1');
    await userEvent.click(screen.getAllByRole('button', { name: 'opsFix.prospects.actions.convert' })[1] as HTMLElement);
    expect(await screen.findByText('Akun pelanggan tidak ditemukan')).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'opsFix.prospects.actions.convert' })[1] as HTMLElement);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toEqual({ customerId: 'cust-1' });
  });

  it('asks for an account after the server answers 422 for a row that has a number', async () => {
    load(detail({ status: 'INTERESTED' }));
    post.mockRejectedValueOnce(new FakeApiError(422, 'Prospek ini tidak punya nomor HP'));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.convert'));
    await userEvent.click(screen.getAllByRole('button', { name: 'opsFix.prospects.actions.convert' })[1] as HTMLElement);
    expect(await screen.findByLabelText('opsFix.prospects.convertForm.customerId')).toBeTruthy();
  });

  it('marks do-not-contact only after the confirm, with the reason, then reloads', async () => {
    load(detail());
    post.mockResolvedValue({});
    ask.mockResolvedValueOnce(false);
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.dnc'));
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.dncForm.reason'), 'WRONG_NUMBER');
    const go = screen.getAllByRole('button', { name: 'opsFix.prospects.actions.dnc' })[1] as HTMLElement;
    await userEvent.click(go);
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(go);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects/p-1/do-not-contact');
    expect(post.mock.calls[0]?.[1]).toEqual({ reason: 'WRONG_NUMBER' });
    expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'opsFix.prospects.dncForm.confirmBody' }));
  });

  it('reports a failed do-not-contact', async () => {
    load(detail());
    post.mockRejectedValue(new FakeApiError(409, 'Prospek ini sudah selesai'));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.dnc'));
    await userEvent.click(screen.getAllByRole('button', { name: 'opsFix.prospects.actions.dnc' })[1] as HTMLElement);
    expect(await screen.findByText('Prospek ini sudah selesai')).toBeTruthy();
  });

  it('reopens a LOST row for a manager only, sending the version', async () => {
    load(detail({ status: 'LOST', lostReason: 'harga' }));
    patch.mockResolvedValue(detail({ status: 'NEW' }));
    render(<ProspectDetailPage />);
    expect(await screen.findByText('harga')).toBeTruthy();
    await userEvent.click(await button('opsFix.prospects.actions.reopen'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[1]).toEqual({ status: 'NEW', seenUpdatedAt: UPDATED });
    cleanup();

    auth.role = 'C_sales';
    loadSessionCapabilities('C_sales', ['b2bProspectWork']);
    load(detail({ status: 'LOST' }));
    render(<ProspectDetailPage />);
    await screen.findByText('Kos Mawar');
    expect(screen.queryByRole('button', { name: 'opsFix.prospects.actions.reopen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'opsFix.prospects.actions.assign' })).toBeNull();
  });

  it('reports a failed reopen', async () => {
    load(detail({ status: 'LOST' }));
    patch.mockRejectedValue(new FakeApiError(409, 'Transisi tidak diizinkan'));
    render(<ProspectDetailPage />);
    await userEvent.click(await button('opsFix.prospects.actions.reopen'));
    expect(await screen.findByText('Transisi tidak diizinkan')).toBeTruthy();
  });

  it('offers no action on a finished prospect, and shows when it became a customer', async () => {
    load(detail({ status: 'CONVERTED', convertedAt: '2026-11-05T02:00:00.000Z', visits: [] }));
    render(<ProspectDetailPage />);
    expect(await screen.findByText('opsFix.prospects.detail.noVisits')).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.detail.convertedAt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'opsFix.prospects.actions.dnc' })).toBeNull();
  });

  it('keeps a missing id on the not-found card', async () => {
    query.id = '';
    load(detail());
    render(<ProspectDetailPage />);
    expect(await screen.findByText('opsFix.prospects.detail.notFound')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('shows the placeholder for a prospect without optional fields and labels who it is assigned to', async () => {
    load(
      detail({
        address: null,
        phoneE164: null,
        contactName: null,
        note: null,
        licence: null,
        sourceId: null,
        sourceDate: null,
        sourceDataset: null,
        lastActivityAt: null,
        ownerDepotId: null,
        assignedToId: 'u-1',
      }),
    );
    render(<ProspectDetailPage />);
    expect(await screen.findByText('opsFix.prospects.me')).toBeTruthy();
    expect(screen.getAllByText('opsFix.prospects.detail.none').length).toBeGreaterThan(5);
    expect(screen.getByText(/opsFix.prospects.noDepot/)).toBeTruthy();
  });

  it('names a colleague "Staf lain" when the roster is down, and shows an HQ-set owner', async () => {
    load(detail({ assignedToId: 'staff-9', ownerSource: 'HQ' }), new FakeApiError(503, 'down'));
    render(<ProspectDetailPage />);
    expect(await screen.findByText('opsFix.prospects.otherStaff')).toBeTruthy();
    expect(screen.getByText(/opsFix.prospects.detail.ownerHq/)).toBeTruthy();
  });
});
