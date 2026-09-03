// @vitest-environment jsdom
/**
 * G6 promoted this control: on a phone it is now the app bar's home slot, so it is the
 * primary way a customer says where they are. It had no test of its own.
 *
 * It was not merely untested — it was reported as `1/1` lines, "100% covered", because
 * nothing in the suite ever imported it. Rendering it from the app-bar test turned that
 * phantom into an honest 30/97 and the gate moved DOWN by more than half a point without a
 * single line of behaviour changing. These tests pay that back with real coverage rather
 * than by hiding the module again behind a mock.
 *
 * The rule they exist to pin is A3's, on this side of it: only a depot whose radius COVERS
 * the point may be stored. The stored `depotId` is what G3 defaults checkout to, so an
 * out-of-range one here becomes a checkout the server refuses.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${Object.values(vars).join(',')}` : k,
  }),
}));

import { LocationSelector } from '@/components/location-selector';
import { LocationProvider } from '@/lib/location-context';
import { getLocation } from '@/lib/location-store';

const DEPOT = { id: 'd1', name: 'Depot Cikini', city: 'Jakarta', lat: -6.19, lng: 106.84 };

/** A device that answers every geolocation call with the same fix. */
function deviceAt(latitude: number, longitude: number) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude, longitude } } as GeolocationPosition),
    },
  });
}

/** A device whose providers all fail with the given code. */
function deviceFails(code: number) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback | null) =>
        err?.({ code } as GeolocationPositionError),
    },
  });
}

const open = () => fireEvent.click(screen.getByRole('button', { expanded: false }));
const show = () => render(<LocationSelector />, { wrapper: LocationProvider });

beforeEach(() => {
  get.mockReset().mockResolvedValue({ items: [DEPOT], total: 1, page: 1, limit: 50 });
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('LocationSelector', () => {
  it('starts with no location set', () => {
    show();
    expect(screen.getByText('home.location.placeholder')).toBeTruthy();
  });

  it('loads the depot list only once the panel is opened', async () => {
    show();
    expect(get).not.toHaveBeenCalled();
    open();
    await waitFor(() => expect(screen.getByText(/Depot Cikini/)).toBeTruthy());
  });

  it('stores the depot a customer picks by city, and closes', async () => {
    show();
    open();
    fireEvent.click(await screen.findByText(/Depot Cikini/));
    await waitFor(() => expect(getLocation()).toMatchObject({ label: 'Jakarta', depotId: 'd1' }));
    expect(screen.queryByText('home.location.orPickCity')).toBeNull();
  });

  it('names the city when the device lands inside a depot radius', async () => {
    deviceAt(-6.19, 106.84);
    get.mockImplementation(async (path: string) =>
      path.includes('nearby')
        ? [{ ...DEPOT, distanceKm: 0.1, withinService: true }]
        : { items: [DEPOT], total: 1, page: 1, limit: 50 },
    );
    show();
    open();
    fireEvent.click(screen.getByText('home.location.useMyLocation'));
    await waitFor(() =>
      expect(getLocation()).toMatchObject({ label: 'home.location.near:Jakarta', depotId: 'd1' }),
    );
  });

  /*
   * A3/G3. The old code took `near[0]` whichever it was and only softened the label, so a
   * customer outside every radius still carried a depot id — and G3 defaults checkout's
   * depot from exactly this value, which would have handed checkout a depot the server
   * refuses. The coordinates are still stored: knowing where you are is useful even when
   * nobody delivers there.
   */
  it('stores the point but no depot when every candidate is out of range', async () => {
    deviceAt(-6.2088, 106.8456);
    get.mockImplementation(async (path: string) =>
      path.includes('nearby')
        ? [{ ...DEPOT, distanceKm: 14.98, withinService: false }]
        : { items: [DEPOT], total: 1, page: 1, limit: 50 },
    );
    show();
    open();
    fireEvent.click(screen.getByText('home.location.useMyLocation'));
    await waitFor(() => expect(getLocation()).toMatchObject({ label: 'home.location.myLocation' }));
    expect(getLocation()?.depotId).toBeUndefined();
  });

  it('still stores the point when the nearby lookup itself fails', async () => {
    deviceAt(-6.19, 106.84);
    get.mockImplementation(async (path: string) => {
      if (path.includes('nearby')) throw new Error('down');
      return { items: [DEPOT], total: 1, page: 1, limit: 50 };
    });
    show();
    open();
    fireEvent.click(screen.getByText('home.location.useMyLocation'));
    await waitFor(() => expect(getLocation()).toMatchObject({ lat: -6.19, lng: 106.84 }));
  });

  it('names which geolocation failure happened', async () => {
    deviceFails(1);
    show();
    open();
    fireEvent.click(screen.getByText('home.location.useMyLocation'));
    // Only the message is asserted: `location-store` keeps an in-memory cache that outlives
    // a `localStorage.clear()`, so "nothing was stored" is a claim about the store's test
    // isolation rather than about this component.
    await waitFor(() => expect(screen.getByText('home.location.denied')).toBeTruthy());
  });

  // An unread list leaves the picker silently empty, and then the only way left to set a
  // location is geolocation — exactly what someone who declined the permission cannot use.
  it('offers a retry when the depot list cannot be read', async () => {
    get.mockRejectedValue(new Error('offline'));
    show();
    open();
    await waitFor(() => expect(screen.getByText('common.retry')).toBeTruthy());
  });

  it('says so when there are no depots at all', async () => {
    get.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
    show();
    open();
    await waitFor(() => expect(screen.getByText('home.location.noDepots')).toBeTruthy());
  });
});

/*
 * Photographed on a real phone, 2 September 2026: the app-bar panel opened off the LEFT
 * edge of the screen and the list read "encari lokasi…".
 *
 * `right-0` anchors the panel's right edge to its trigger's, which opens it leftward. That
 * is correct beside the depot card's right-hand header and wrong in the app bar, where the
 * trigger sits at the left of a 360pt screen and 288pt of panel has nowhere to go.
 * `max-w-[calc(100vw-2rem)]` caps the width; it cannot move the box back on screen.
 */
describe('where the panel opens', () => {
  const panel = () => document.querySelector('[class*="absolute"][class*="z-20"]');

  it('anchors left on a phone and right again from sm: up', async () => {
    render(<LocationSelector compact />, { wrapper: LocationProvider });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    await waitFor(() => expect(panel()).toBeTruthy());

    const cls = panel()?.className ?? '';
    expect(cls).toContain('left-0');
    expect(cls).toContain('sm:right-0');
    // The width cap stays: it is what keeps a 288pt panel inside a 320pt screen.
    expect(cls).toContain('max-w-[calc(100vw-2rem)]');
  });

  it('leaves the full-width instance anchored left, as it always was', async () => {
    show();
    open();
    await waitFor(() => expect(panel()).toBeTruthy());
    expect(panel()?.className).toContain('left-0');
    expect(panel()?.className).not.toContain('sm:right-0');
  });
});
