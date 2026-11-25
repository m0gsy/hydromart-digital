// @vitest-environment jsdom
/**
 * Flow plan 5d: the courier's one-tap check-in. One face photo starts the shift AND records
 * HR attendance (owner decision 2026-11-17), behind the brake `attendance.courier_one_tap`,
 * read fail-closed: an unread or released-only-partly flag is the two separate check-ins.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, replace, runOrQueue, live } = vi.hoisted(() => ({
  get: vi.fn(),
  replace: vi.fn(),
  runOrQueue: vi.fn(),
  live: { current: true },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/driver/shift/check-in',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'c1', role: 'STAFF_DEPOT', fullName: 'Budi', assignedDepotId: 'depot-1' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn() } };
});
vi.mock('@/lib/offline-queue', () => ({ runOrQueue }));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/push', () => ({ requestPushOnce: vi.fn() }));
vi.mock('@/components/hr/face-capture', () => ({
  FaceCapture: ({
    onCapture,
    disabled,
  }: {
    onCapture: (image: string, live: boolean) => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onCapture('data:image/jpeg;base64,AAA', live.current)}>
      capture
    </button>
  ),
}));

import CheckInPage from '@/app/driver/shift/check-in/page';
import { ApiError } from '@/lib/api';
import { id as idDict } from '@/lib/dictionaries/id';
import { endpoints } from '@/lib/endpoints';
import { LocaleProvider } from '@/lib/locale-context';

const C = idDict.driver.checkIn;
const AT = { lat: -6.25, lng: 106.99 };

let flags: unknown = [{ key: 'attendance.courier_one_tap', enabled: true }];
let enrolled: unknown = { enrolled: true };

const draw = () =>
  render(
    <LocaleProvider>
      <CheckInPage />
    </LocaleProvider>,
  );

const jobs = () => runOrQueue.mock.calls.map(([job]) => job.kind as string);

beforeEach(() => {
  flags = [{ key: 'attendance.courier_one_tap', enabled: true }];
  enrolled = { enrolled: true };
  live.current = true;
  replace.mockReset();
  runOrQueue.mockReset().mockImplementation((job: { kind: string }) =>
    Promise.resolve({
      outcome: 'sent',
      result: job.kind === 'hrPunch' ? { status: 'PRESENT', checkInAt: '2026-11-20T00:00:00Z' } : {},
    }),
  );
  get.mockReset().mockImplementation((url: string) => {
    if (url === endpoints.admin.publicFlags)
      return flags instanceof Error ? Promise.reject(flags) : Promise.resolve(flags);
    if (url === endpoints.hr.faceDataMe)
      return enrolled instanceof Error ? Promise.reject(enrolled) : Promise.resolve(enrolled);
    if (url === endpoints.deliveries.shifts.current) return Promise.resolve(null);
    return Promise.resolve({ items: [], total: 0, page: 1, limit: 20 });
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: AT.lat, longitude: AT.lng, accuracy: 5 } } as GeolocationPosition),
    },
  });
});
afterEach(() => vi.clearAllMocks());

describe('one tap: the shift and the attendance from one face photo', () => {
  it('starts the shift, punches in with the same photo and position, then opens the task list', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    // The shift says how sure the phone was too: delivery-service names a "Perkiraan" fix by it,
    // including Android 16's pattern off the 2 km grid (2026-11-25).
    expect(runOrQueue).toHaveBeenNthCalledWith(1, {
      kind: 'shiftCheckIn',
      payload: { depotId: 'depot-1', ...AT, accuracyM: 5 },
    });
    // The HR punch also says how sure the phone was, so hr-service can tell a "Perkiraan" fix.
    expect(runOrQueue).toHaveBeenNthCalledWith(2, {
      kind: 'hrPunch',
      payload: { mode: 'in', image: 'data:image/jpeg;base64,AAA', ...AT, accuracyM: 5 },
    });
    // The plain shift button is not offered beside it.
    expect(screen.queryByRole('button', { name: C.submit })).toBeNull();
  });

  it('a fix with no accuracy sends none, rather than a NaN the DTO would refuse', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: AT.lat, longitude: AT.lng, accuracy: Number.NaN } } as GeolocationPosition),
      },
    });
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    const punch = runOrQueue.mock.calls.find(([job]) => job.kind === 'hrPunch')?.[0];
    expect(JSON.parse(JSON.stringify(punch.payload))).toEqual({
      mode: 'in',
      image: 'data:image/jpeg;base64,AAA',
      ...AT,
    });
    const shift = runOrQueue.mock.calls.find(([job]) => job.kind === 'shiftCheckIn')?.[0];
    expect(JSON.parse(JSON.stringify(shift.payload))).toEqual({ depotId: 'depot-1', ...AT });
  });

  // Every DTO that takes the accuracy refuses a negative one (Min 0), and a refused check-in is
  // final in the offline queue. No phone should report one, but the check-in must not hang on it.
  it('a negative accuracy is left off both, rather than turning them into a 400', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: AT.lat, longitude: AT.lng, accuracy: -1 } } as GeolocationPosition),
      },
    });
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    expect(jobs()).toEqual(['shiftCheckIn', 'hrPunch']);
    for (const [job] of runOrQueue.mock.calls) {
      expect(JSON.parse(JSON.stringify(job.payload))).not.toHaveProperty('accuracyM');
    }
  });

  it('half done: the shift opened, the face was refused — says so, and a retry punches alone', async () => {
    runOrQueue.mockImplementation((job: { kind: string }) =>
      job.kind === 'hrPunch'
        ? Promise.reject(new ApiError(403, 'Wajah tidak cocok'))
        : Promise.resolve({ outcome: 'sent', result: {} }),
    );
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    expect(await screen.findByText(/Wajah tidak cocok/)).toBeTruthy();
    expect(screen.getByText(/Shift sudah dimulai/)).toBeTruthy();
    expect(screen.getByRole('link', { name: C.continueWithout }).getAttribute('href')).toBe('/driver');
    expect(replace).not.toHaveBeenCalled();

    runOrQueue.mockImplementation(() =>
      Promise.resolve({ outcome: 'sent', result: { status: 'PRESENT' } }),
    );
    await user.click(screen.getByRole('button', { name: 'capture' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    expect(jobs()).toEqual(['shiftCheckIn', 'hrPunch', 'hrPunch']);
  });

  it('a punch held for HR (PENDING) is said, not painted as a success', async () => {
    runOrQueue.mockImplementation((job: { kind: string }) =>
      Promise.resolve({ outcome: 'sent', result: job.kind === 'hrPunch' ? { status: 'PENDING' } : {} }),
    );
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    expect(await screen.findByText(C.pending)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: C.continue }));
    expect(replace).toHaveBeenCalledWith('/driver');
  });

  it('offline: both wait on the phone, and the screen says the shift has not started yet', async () => {
    runOrQueue.mockResolvedValue({ outcome: 'queued' });
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    expect(await screen.findByText(C.queuedOffline)).toBeTruthy();
    expect(jobs()).toEqual(['shiftCheckIn', 'hrPunch']);
    expect(replace).not.toHaveBeenCalled();
    // Nothing left to tap: a second photo would queue a second check-in and a second punch.
    expect(screen.queryByRole('button', { name: 'capture' })).toBeNull();
  });

  it('the shift went through and only the punch is queued: the shift is open, so on to the tasks', async () => {
    runOrQueue.mockImplementation((job: { kind: string }) =>
      Promise.resolve(job.kind === 'hrPunch' ? { outcome: 'queued' } : { outcome: 'sent', result: {} }),
    );
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    expect(screen.queryByText(C.queuedOffline)).toBeNull();
  });

  it('a retry after a shift that only queued still knows the shift has not reached the server', async () => {
    let punches = 0;
    runOrQueue.mockImplementation((job: { kind: string }) => {
      if (job.kind === 'shiftCheckIn') return Promise.resolve({ outcome: 'queued' });
      punches += 1;
      return punches === 1
        ? Promise.reject(new ApiError(403, 'Wajah tidak cocok'))
        : Promise.resolve({ outcome: 'sent', result: { status: 'PRESENT' } });
    });
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    expect(await screen.findByText(/Wajah tidak cocok/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'capture' }));
    expect(await screen.findByText(C.queuedOffline)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(jobs()).toEqual(['shiftCheckIn', 'hrPunch', 'hrPunch']);
  });

  it('a frame the device judged not live is not sent at all', async () => {
    live.current = false;
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    expect(await screen.findByText(idDict.hrFix.checkIn.faceUnsure)).toBeTruthy();
    expect(runOrQueue).not.toHaveBeenCalled();
  });

  it('a GPS failure records nothing and says why, translated', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback | null) =>
          err?.({ code: 1 } as GeolocationPositionError),
      },
    });
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    expect(await screen.findByText(idDict.errors.geo.denied)).toBeTruthy();
    expect(runOrQueue).not.toHaveBeenCalled();
  });
});

describe('the brake, and the courier the one tap cannot serve', () => {
  it.each([
    ['released only on the server side being off', [{ key: 'attendance.courier_one_tap', enabled: false }]],
    ['missing from the list', [{ key: 'subscriptions.galon', enabled: true }]],
    ['unreadable', new Error('down')],
  ])('the flag %s: the two separate check-ins, the face is not even asked about', async (_why, value) => {
    flags = value;
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: C.submit }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    expect(jobs()).toEqual(['shiftCheckIn']);
    // The plain shift check-in carries the phone's accuracy as the one tap does.
    expect(runOrQueue.mock.calls[0]?.[0].payload).toEqual({ depotId: 'depot-1', ...AT, accuracyM: 5 });
    expect(screen.queryByRole('button', { name: 'capture' })).toBeNull();
    expect(get.mock.calls.map(([u]) => u)).not.toContain(endpoints.hr.faceDataMe);
  });

  it('no face enrolled: points at enrolment, and still lets the shift start on its own', async () => {
    enrolled = { enrolled: false };
    const user = userEvent.setup();
    draw();
    expect(await screen.findByText(C.enrollFirstTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: C.enrollAction }).getAttribute('href')).toBe('/hr/me/enroll');
    expect(screen.queryByRole('button', { name: 'capture' })).toBeNull();
    await user.click(screen.getByRole('button', { name: C.shiftOnly }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    expect(jobs()).toEqual(['shiftCheckIn']);
  });

  it('an account with no employee record (the face read fails): the plain shift check-in', async () => {
    enrolled = new ApiError(404, 'Karyawan tidak ditemukan');
    draw();
    expect(await screen.findByRole('button', { name: C.submit })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'capture' })).toBeNull();
    expect(screen.queryByText(C.enrollFirstTitle)).toBeNull();
  });
});

/*
 * 2026-11-25: Muhammad Rouf stood in Depot Jatibening and was refused at "1391 m" — his phone held
 * only "Perkiraan". The screen says so before he taps, and the tap itself is never held back by
 * it: whether such a fix is good enough is the server's call.
 */
describe('a phone on "Perkiraan"', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'Capacitor');
  });

  it('is told so before the tap, and the tap still goes through', async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      Plugins: {
        Geolocation: {
          checkPermissions: () => Promise.resolve({ location: 'denied', coarseLocation: 'granted' }),
        },
      },
    };
    const user = userEvent.setup();
    draw();
    expect(await screen.findByText(idDict.hrFix.preciseLocation.title)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'capture' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver'));
    expect(jobs()).toEqual(['shiftCheckIn', 'hrPunch']);
  });

  it('says nothing on a phone with precise location', async () => {
    const checkPermissions = vi.fn(() => Promise.resolve({ location: 'granted', coarseLocation: 'granted' }));
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      Plugins: { Geolocation: { checkPermissions } },
    };
    draw();
    await screen.findByRole('button', { name: 'capture' });
    await waitFor(() => expect(checkPermissions).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(idDict.hrFix.preciseLocation.title)).toBeNull();
  });
});
