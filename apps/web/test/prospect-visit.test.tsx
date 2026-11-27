// @vitest-environment jsdom
//
// AREA-2c: the GPS check-in on the prospect detail page. A precise fix with a stated accuracy or no
// call at all; the server's refusal text is shown as it is; a lost, converted or refused row has no panel.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, position, toast, auth, FakeApiError, FakeGeoError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  position: vi.fn(),
  toast: vi.fn(),
  auth: { role: 'KEPALA_DEPOT' },
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
  FakeGeoError: class extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post, patch: vi.fn() }, ApiError: FakeApiError }));
vi.mock('@/lib/geo', () => ({ currentPosition: position, GeoError: FakeGeoError, approximateOnly: async () => false }));
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
  useDepot: () => ({ depots: [{ id: 'dep-a', code: 'BKS', name: 'Bekasi' }], selectedId: null }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/hr/precise-location-notice', () => ({
  PreciseLocationNotice: () => <p>precise-notice</p>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'p-1' }));

import ProspectDetailPage from '@/app/dashboard/prospects/detail/page';
import { loadSessionCapabilities } from '@/lib/roles';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  name: 'Kos Mawar',
  category: 'KOS',
  address: null,
  latitude: -6.2,
  longitude: 106.9,
  kecamatanCode: null,
  kelurahanCode: null,
  ownerDepotId: 'dep-a',
  ownerSource: 'AUTO',
  status: 'NEW',
  assignedToId: 'u-1',
  source: 'FIELD',
  sourceDate: null,
  createdAt: '2026-11-01T01:00:00.000Z',
  updatedAt: '2026-11-02T01:00:00.000Z',
  hasPhone: false,
  phoneE164: null,
  contactName: null,
  note: null,
  licence: null,
  sourceId: null,
  sourceDataset: null,
  customerId: null,
  convertedAt: null,
  lostReason: null,
  assignedAt: null,
  lastActivityAt: null,
  visits: [],
  ...over,
});
const fix = (accuracy: number) => ({ coords: { latitude: -6.2001, longitude: 106.9001, accuracy } });
const go = async () => userEvent.click(await screen.findByRole('button', { name: 'opsFix.prospectsField.visit.begin' }));

beforeEach(() => {
  auth.role = 'KEPALA_DEPOT';
  loadSessionCapabilities(null, null);
  for (const m of [get, post, position, toast]) m.mockReset();
  get.mockResolvedValue(row());
});
afterEach(cleanup);

describe('prospect check-in', () => {
  it('asks for a precise fix and sends it with the rounded accuracy and the outcome', async () => {
    position.mockResolvedValue(fix(12.6));
    post.mockResolvedValue({ prospect: row({ status: 'VISITED' }), visit: { id: 'v-1' } });
    render(<ProspectDetailPage />);
    expect(await screen.findByText('precise-notice')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospectsField.visit.outcome'), 'LEFT_MATERIAL');
    await userEvent.type(screen.getByLabelText('opsFix.prospectsField.visit.note'), ' brosur ');
    await go();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(position).toHaveBeenCalledWith({ precise: true });
    expect(post.mock.calls[0]?.[0]).toBe('/b2b-prospects/api/v1/b2b-prospects/p-1/visits');
    expect(post.mock.calls[0]?.[1]).toEqual({
      latitude: -6.2001,
      longitude: 106.9001,
      accuracyM: 13,
      outcome: 'LEFT_MATERIAL',
      note: 'brosur',
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('opsFix.prospectsField.visit.saved', 'success'));
    // The row the server returned replaces the shown one: the status moved on.
    expect(await screen.findByText('opsFix.prospects.status.VISITED')).toBeTruthy();
  });

  it('leaves the note out when it is empty', async () => {
    position.mockResolvedValue(fix(5));
    post.mockResolvedValue({ prospect: row(), visit: {} });
    render(<ProspectDetailPage />);
    await go();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('note');
  });

  it.each([[Number.NaN], [-1]])('never calls the API for an accuracy of %s', async (accuracy) => {
    position.mockResolvedValue(fix(accuracy));
    render(<ProspectDetailPage />);
    await go();
    expect(await screen.findByText('errors.geo.unavailable')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows a location failure by its reason, without calling the API', async () => {
    position.mockRejectedValue(new FakeGeoError('denied'));
    render(<ProspectDetailPage />);
    await go();
    expect(await screen.findByText('errors.geo.denied')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the server refusal text as it is (too far, approximate fix)', async () => {
    position.mockResolvedValue(fix(8));
    post.mockRejectedValue(new FakeApiError(422, 'Di luar area usaha (350 m dari titik, batas 200 m).'));
    render(<ProspectDetailPage />);
    await go();
    expect(await screen.findByText('Di luar area usaha (350 m dari titik, batas 200 m).')).toBeTruthy();
    expect(toast).not.toHaveBeenCalled();
  });

  it('falls back to the generic text when the refusal has no message', async () => {
    position.mockResolvedValue(fix(8));
    post.mockRejectedValue(new FakeApiError(500, ''));
    render(<ProspectDetailPage />);
    await go();
    expect(await screen.findByText('opsFix.prospectsField.visit.failed')).toBeTruthy();
  });

  it('reloads the row on a 409 and says it changed', async () => {
    position.mockResolvedValue(fix(8));
    post.mockRejectedValue(new FakeApiError(409, 'stale'));
    render(<ProspectDetailPage />);
    await go();
    expect(await screen.findByText('opsFix.prospectsField.visit.changed')).toBeTruthy();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  });

  it('says there is no signal when the call never reached the server, and queues nothing', async () => {
    position.mockResolvedValue(fix(8));
    post.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ProspectDetailPage />);
    await go();
    expect(await screen.findByText('opsFix.prospectsField.visit.networkFailed')).toBeTruthy();
    expect(localStorage.length).toBe(0);
  });

  it.each(['LOST', 'CONVERTED', 'DO_NOT_CONTACT'])('has no check-in panel on a %s row', async (status) => {
    get.mockResolvedValue(row({ status }));
    render(<ProspectDetailPage />);
    expect(await screen.findByText('Kos Mawar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'opsFix.prospectsField.visit.begin' })).toBeNull();
  });

  it('has no check-in panel on a row with no owner depot', async () => {
    get.mockResolvedValue(row({ ownerDepotId: null }));
    render(<ProspectDetailPage />);
    expect(await screen.findByText('Kos Mawar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'opsFix.prospectsField.visit.begin' })).toBeNull();
  });
});
