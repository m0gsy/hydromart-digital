// @vitest-environment jsdom
//
// The depot incident inbox, beyond the complaint link CA-2-58 added to it.
//
// This screen is where a complaint now either travels to head office or visibly does not,
// so what it says about the rest of its rows matters more than it did: a queue that
// miscounts, filters wrongly, or swallows a failed resolve is a queue people stop reading —
// and an unread inbox is the same silence CA-2-58 exists to end.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The error class is hoisted with the mocks: `vi.mock`'s factory runs before any
// top-level statement in this file, so a class declared out here would not exist yet.
const { get, post, patch, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch },
  ApiError: FakeApiError,
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' }],
    selected: { id: 'd-1', code: 'JKT-01', name: 'Jakarta Pusat' },
    scopedId: 'd-1',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));

import IncidentsPage from '@/app/dashboard/incidents/page';

const incident = (over: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  depotId: 'd-1',
  type: 'GALLON_DAMAGE',
  severity: 'MEDIUM',
  status: 'OPEN',
  title: 'Galon retak di gudang',
  description: null,
  reportedBy: 'staff-1',
  courierName: null,
  orderRef: null,
  customerPhone: null,
  hqTicketRef: null,
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: '2026-09-09T02:00:00.000Z',
  updatedAt: '2026-09-09T02:00:00.000Z',
  ...over,
});

function route(rows: unknown[]) {
  return (raw: unknown) => {
    const path = String(raw ?? '');
    if (path.includes('field-incidents')) return Promise.resolve([]);
    if (path.includes('incidents')) return Promise.resolve(rows);
    return Promise.resolve([]);
  };
}

beforeEach(() => {
  get.mockReset().mockImplementation(route([]));
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('the depot incident inbox', () => {
  it('shows an empty inbox as empty, not as a failure', async () => {
    render(<IncidentsPage />);
    expect(await screen.findByText('dashB.incidents.emptyAll')).toBeTruthy();
  });

  it('says the read failed rather than showing an empty depot', async () => {
    // An inbox that renders "no incidents" when the request died is the worst answer of
    // the three: it looks like good news.
    get.mockImplementation((raw: unknown) =>
      String(raw ?? '').includes('field-incidents')
        ? Promise.resolve([])
        : Promise.reject(new FakeApiError(500, 'depot-service down')),
    );
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/depot-service down/)).toBeTruthy());
  });

  it('narrows to one status, and counts only what that status holds', async () => {
    const user = userEvent.setup();
    get.mockImplementation(
      route([
        incident({ id: 'a', status: 'OPEN', title: 'Galon retak' }),
        incident({ id: 'b', status: 'RESOLVED', title: 'Listrik padam', resolutionNote: 'PLN' }),
      ]),
    );
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Galon retak/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /dashB\.incidents\.chipResolved/ }));
    expect(screen.queryByText(/Galon retak/)).toBeNull();
    expect(screen.getByText(/Listrik padam/)).toBeTruthy();
  });

  it('refuses to close an incident with no explanation of how', async () => {
    // The resolution note IS the record: "resolved" with nothing beside it tells the next
    // shift only that somebody clicked.
    const user = userEvent.setup();
    get.mockImplementation(route([incident()]));
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Galon retak/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'dashB.incidents.followUp' }));
    await user.click(screen.getByRole('button', { name: 'dashB.incidents.markDone' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it('closes it with the note, and re-reads instead of trusting its own copy', async () => {
    const user = userEvent.setup();
    get.mockImplementation(route([incident()]));
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Galon retak/)).toBeTruthy());
    const readsBefore = get.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'dashB.incidents.followUp' }));
    await user.type(screen.getByLabelText('dashB.incidents.noteLabel'), 'Galon diganti');
    await user.click(screen.getByRole('button', { name: 'dashB.incidents.markDone' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toEqual({ note: 'Galon diganti' });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('surfaces the server reason when the close is refused', async () => {
    const user = userEvent.setup();
    get.mockImplementation(route([incident()]));
    patch.mockRejectedValue(new FakeApiError(409, 'Insiden sudah ditutup orang lain'));
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Galon retak/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'dashB.incidents.followUp' }));
    await user.type(screen.getByLabelText('dashB.incidents.noteLabel'), 'Galon diganti');
    await user.click(screen.getByRole('button', { name: 'dashB.incidents.markDone' }));

    expect(await screen.findByText('Insiden sudah ditutup orang lain')).toBeTruthy();
  });

  it('shows a closed incident its note, and says so when there is none', async () => {
    const user = userEvent.setup();
    get.mockImplementation(
      route([
        incident({ id: 'a', status: 'RESOLVED', resolutionNote: 'Diganti baru', resolvedAt: '2026-09-09T03:00:00.000Z' }),
        incident({ id: 'b', status: 'RESOLVED', title: 'Listrik padam' }),
      ]),
    );
    render(<IncidentsPage />);
    await waitFor(() => expect(screen.getByText(/Galon retak/)).toBeTruthy());

    const details = screen.getAllByRole('button', { name: 'dashB.incidents.detail' });
    await user.click(details[0]!);
    expect(screen.getByText('Diganti baru')).toBeTruthy();

    await user.click(details[1]!);
    expect(screen.getByText('dashB.incidents.noResolutionNote')).toBeTruthy();
  });

  it('refuses a report whose title says nothing', async () => {
    const user = userEvent.setup();
    render(<IncidentsPage />);
    await user.click(await screen.findByRole('button', { name: 'dashB.incidents.reportTitle' }));
    await user.click(screen.getByRole('button', { name: 'dashB.incidents.submitReport' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('says why a report was refused, and leaves what was typed on screen', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new FakeApiError(400, 'Depot tidak dikenal'));
    render(<IncidentsPage />);
    await user.click(await screen.findByRole('button', { name: 'dashB.incidents.reportTitle' }));
    await user.type(screen.getByLabelText('dashB.incidents.titleLabel'), 'Galon retak');
    await user.click(screen.getByRole('button', { name: 'dashB.incidents.submitReport' }));

    expect(await screen.findByText('Depot tidak dikenal')).toBeTruthy();
    expect((screen.getByLabelText('dashB.incidents.titleLabel') as HTMLInputElement).value).toBe(
      'Galon retak',
    );
  });
});
