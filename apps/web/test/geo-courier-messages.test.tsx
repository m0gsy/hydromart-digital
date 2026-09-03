// @vitest-environment jsdom
/**
 * J1 · the two courier screens that answered a location failure with silence or a token.
 *
 * Both were found while chasing the native geolocation bug, and neither needs a device to
 * prove: they are what the courier is shown once `currentPosition` rejects.
 *
 *  - Shift status read the position OUTSIDE the try that owns the error line, so tapping
 *    "tutup shift" with GPS off did nothing at all — no message, no reset.
 *  - Check-in rendered `e.message` raw, and `GeoError.message` is its reason token, so a
 *    slow fix printed the bare English word "timeout" onto an Indonesian screen.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
let customer: { id: string; role: string; assignedDepotId?: string | null } | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/driver/shift/status',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch: vi.fn() } };
});
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/push', () => ({ requestPushOnce: vi.fn() }));

import { LocaleProvider } from '@/lib/locale-context';
import { id as idDict } from '@/lib/dictionaries/id';
import ShiftStatusPage from '@/app/driver/shift/status/page';
import CheckInPage from '@/app/driver/shift/check-in/page';

/**
 * The device, not `currentPosition`, is what is faked here. Mocking the helper would load a
 * second, never-executed copy of `lib/geo.ts` beside the real one and report it as dead
 * code; failing at the browser API instead exercises the real retry ladder — which is also
 * the honest shape of the bug, since both legs fail when the position is unavailable.
 */
function deviceFails(code: number) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback | null) =>
        err?.({ code } as GeolocationPositionError),
    },
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset().mockResolvedValue({});
  customer = { id: 's1', role: 'COURIER', assignedDepotId: 'depot-1' };
});
afterEach(() => vi.clearAllMocks());

describe('J1 · closing a shift without a location', () => {
  it('names the reason instead of doing nothing', async () => {
    get.mockResolvedValue({ id: 'shift-1', status: 'ONLINE', breakSecondsRemaining: 0 });
    deviceFails(2); // both legs answer POSITION_UNAVAILABLE

    render(<ShiftStatusPage />, { wrapper: LocaleProvider });

    const button = await screen.findByRole('button', { name: idDict.driver.shiftStatus.checkOut });
    button.click();

    await waitFor(() => expect(screen.getByText(idDict.errors.geo.unavailable)).toBeTruthy());
    // Nothing was sent, and the screen is usable again.
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('J1 · checking in without a location', () => {
  it('translates the reason instead of printing the token', async () => {
    get.mockResolvedValue(null);
    deviceFails(3); // both legs time out

    render(<CheckInPage />, { wrapper: LocaleProvider });

    const button = await screen.findByRole('button', { name: idDict.driver.checkIn.submit });
    button.click();

    await waitFor(() => expect(screen.getByText(idDict.errors.geo.timeout)).toBeTruthy());
    expect(screen.queryByText('timeout')).toBeNull();
  });
});
