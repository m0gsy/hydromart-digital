// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Job } from '@/lib/offline-queue';
import type { Depot } from '@/lib/types';

/**
 * 2026-11-23, Galaxy and Pekayon: punches refused "1777 m dari titik" because the phones sent
 * Android's approximate fix, snapped to a 2 km grid. The web half of the fix:
 *
 *  - a punch says how sure the phone was (`accuracyM`) and refuses nothing itself — whether
 *    the depot is fenced, and whether a fix that rough passes, is the server's call;
 *  - the attendance point has no network default, and the settings screen says which depots
 *    override a key and where the picked depot's own master location is.
 */

const { get, runOrQueue, currentPosition, approximateOnly, depotState } = vi.hoisted(() => ({
  get: vi.fn(),
  runOrQueue: vi.fn<(job: Job) => Promise<{ outcome: 'queued' }>>(),
  currentPosition: vi.fn<() => Promise<{ coords: { latitude: number; longitude: number; accuracy: number } }>>(),
  approximateOnly: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
  depotState: { depots: [] as Depot[] },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
// A SUPER_ADMIN, so nothing on the network view is locked for any reason but the one tested.
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ ...depotState, selected: null, scopedId: null, ready: true, error: null }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('@/lib/offline-queue', () => ({ runOrQueue }));
vi.mock('@/lib/geo', () => ({ currentPosition, approximateOnly, geoReason: () => 'timeout' }));
vi.mock('@/components/offline-queue-banner', () => ({ OfflineQueueBanner: () => null }));
vi.mock('@/components/hr/face-capture', () => ({
  FaceCapture: ({ onCapture }: { onCapture: (image: string, live: boolean) => void }) => (
    <button type="button" onClick={() => onCapture('data:frame', true)}>
      capture
    </button>
  ),
}));

import CheckInPage from '@/app/hr/me/check-in/page';
import HrSettingsPage from '@/app/hr/settings/page';

describe('the punch says how sure the phone was', () => {
  const fix = (accuracy: number) => ({ coords: { latitude: -6.27027, longitude: 106.96421, accuracy } });

  beforeEach(() => {
    runOrQueue.mockReset().mockResolvedValue({ outcome: 'queued' });
    currentPosition.mockReset();
    approximateOnly.mockClear();
  });

  it('sends the accuracy in whole metres, and refuses nothing itself however rough it is', async () => {
    currentPosition.mockResolvedValue(fix(1999.6));
    render(<CheckInPage />);
    fireEvent.click(screen.getByText('capture'));
    await waitFor(() => expect(runOrQueue).toHaveBeenCalledTimes(1));
    expect(currentPosition).toHaveBeenCalledWith({ precise: true });
    expect(runOrQueue.mock.calls[0]?.[0]).toEqual({
      kind: 'hrPunch',
      payload: { mode: 'in', image: 'data:frame', lat: -6.27027, lng: 106.96421, accuracyM: 2000 },
    });
  });

  // hr-service's DTO refuses a negative accuracy (Min 0) and a refusal is final in the offline
  // queue: a punch must never be lost to a number no phone should report anyway.
  it('leaves a negative accuracy off the wire rather than having the punch refused', async () => {
    currentPosition.mockResolvedValue(fix(-1));
    render(<CheckInPage />);
    fireEvent.click(screen.getByText('capture'));
    await waitFor(() => expect(runOrQueue).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(runOrQueue.mock.calls[0]?.[0].payload))).toEqual({
      mode: 'in',
      image: 'data:frame',
      lat: -6.27027,
      lng: 106.96421,
    });
  });

  it('leaves the accuracy off the wire when the phone gave none', async () => {
    currentPosition.mockResolvedValue(fix(Number.NaN));
    render(<CheckInPage />);
    fireEvent.click(screen.getByText('capture'));
    await waitFor(() => expect(runOrQueue).toHaveBeenCalledTimes(1));
    // What the JSON body will hold: nothing, rather than `null` or a NaN the DTO would refuse.
    expect(JSON.parse(JSON.stringify(runOrQueue.mock.calls[0]?.[0].payload))).toEqual({
      mode: 'in',
      image: 'data:frame',
      lat: -6.27027,
      lng: 106.96421,
    });
  });

  // 2026-11-25: with the HR fence off, a phone on "Perkiraan" punched from kilometres away and
  // nothing said so. The screen says it now — and still lets the punch through.
  it('tells a phone on "Perkiraan" so, and still takes the punch', async () => {
    approximateOnly.mockResolvedValueOnce(true);
    currentPosition.mockResolvedValue(fix(2000));
    render(<CheckInPage />);
    expect(await screen.findByText('hrFix.preciseLocation.title')).toBeInTheDocument();
    fireEvent.click(screen.getByText('capture'));
    await waitFor(() => expect(runOrQueue).toHaveBeenCalledTimes(1));
  });

  it('says nothing on a phone with precise location', async () => {
    approximateOnly.mockResolvedValueOnce(false);
    render(<CheckInPage />);
    await waitFor(() => expect(approximateOnly).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('hrFix.preciseLocation.title')).toBeNull();
  });
});

describe('the attendance point on the settings screen', () => {
  const defs = [
    { key: 'geofenceLat', type: 'string', label: 'Titik lat', depotOnly: true },
    { key: 'geofenceRadiusM', type: 'number', label: 'Radius' },
    // The opposite lock, beside it: the two must not cancel each other out.
    { key: 'faceThreshold', type: 'number', label: 'Ambang wajah', global: true },
  ];
  const galaxy: Depot = {
    id: 'depot-galaxy',
    code: 'GLX',
    name: 'Galaxy',
    city: 'Bekasi',
    deliveryFee: 0,
    minOrderAmount: null,
    lat: -6.2616,
    lng: 106.9371,
  };

  beforeEach(() => {
    depotState.depots = [galaxy];
    get.mockReset().mockResolvedValue({
      defs,
      effective: { geofenceLat: '', geofenceRadiusM: 100 },
      overrides: {
        // An empty row is an override too: that depot's point is its own master location.
        geofenceLat: [{ depotId: 'depot-galaxy', value: '' }],
        geofenceRadiusM: [
          { depotId: 'depot-galaxy', value: '150' },
          { depotId: '0123456789abcdef', value: '200' },
        ],
      },
    });
  });

  const pickDepot = (id: string) => {
    fireEvent.change(screen.getByLabelText('hrFix.settings.scopeLabel'), { target: { value: 'DEPOT' } });
    fireEvent.change(screen.getByLabelText('hrFix.depotPicker.aria'), { target: { value: id } });
  };
  const saveButtons = () => screen.getAllByRole<HTMLButtonElement>('button', { name: 'hrFix.settings.save' });
  const resetButtons = () => screen.getAllByRole<HTMLButtonElement>('button', { name: 'hrFix.settings.reset' });

  it('locks the point at network scope, even for a SUPER_ADMIN, and says where to set it', async () => {
    render(<HrSettingsPage />);
    const box = await screen.findByLabelText<HTMLInputElement>('Titik lat');
    expect(box.disabled).toBe(true);
    // Row order is def order: the point locked; the radius and the global-only key writable.
    expect(saveButtons().map((b) => b.disabled)).toEqual([true, false, false]);
    expect(resetButtons().map((b) => b.disabled)).toEqual([true, false, false]);
    expect(screen.getByText('hrFix.settings.depotOnlyKey')).toBeTruthy();
  });

  it('opens the point for one depot and shows that depot\'s master location beside it', async () => {
    render(<HrSettingsPage />);
    await screen.findByLabelText('Titik lat');
    pickDepot('depot-galaxy');
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining('depotId=depot-galaxy'), true));
    expect(screen.getByLabelText<HTMLInputElement>('Titik lat').disabled).toBe(false);
    // ...while the global-only key is the one locked here now.
    expect(saveButtons().map((b) => b.disabled)).toEqual([false, false, true]);
    expect(screen.getByLabelText<HTMLInputElement>('Ambang wajah').disabled).toBe(true);
    expect(screen.queryByText('hrFix.settings.depotOnlyKey')).toBeNull();
    expect(screen.getByText('hrFix.settings.masterLocation:-6.2616/106.9371')).toBeTruthy();
  });

  it('says nothing about a master location the depot list does not carry', async () => {
    depotState.depots = [{ ...galaxy, lat: undefined, lng: undefined }];
    render(<HrSettingsPage />);
    await screen.findByLabelText('Titik lat');
    pickDepot('depot-galaxy');
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining('depotId=depot-galaxy'), true));
    expect(screen.queryByText(/hrFix\.settings\.masterLocation/)).toBeNull();
  });

  it('names the depots that override a key on the network view, by a short id when unknown', async () => {
    render(<HrSettingsPage />);
    expect(await screen.findByText('hrFix.settings.overriddenBy:Galaxy (150), 01234567 (200)')).toBeTruthy();
    // An empty value reads as "not filled in", not as a bare "Galaxy ()".
    expect(screen.getByText('hrFix.settings.overriddenBy:Galaxy hrFix.settings.notFilled')).toBeTruthy();
    // Not on a depot's own view, even while the network answer is still the one on screen.
    pickDepot('depot-galaxy');
    expect(screen.queryByText(/hrFix\.settings\.overriddenBy/)).toBeNull();
  });
});
