// @vitest-environment jsdom
/**
 * Flow plan 5d: one announcement inbox for the courier. Depot broadcasts (crm) and HR's
 * announcements lived on two screens, and the courier app opened only the first.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, who } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  who: { depotId: 'depot-1' as string | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/driver/announcements',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'c1', role: 'STAFF_DEPOT', assignedDepotId: who.depotId },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/driver/claimable-orders', () => ({ ClaimableOrders: () => null }));

import AnnouncementsPage from '@/app/driver/announcements/page';
import DriverHome from '@/app/driver/page';
import { ONBOARDED_KEY } from '@/app/driver/onboarding/constants';
import { ApiError } from '@/lib/api';
import { id as idDict } from '@/lib/dictionaries/id';
import { endpoints } from '@/lib/endpoints';
import { LocaleProvider } from '@/lib/locale-context';

const A = idDict.hrFix.driverAnnouncements;

const broadcast = (id: string, title: string, createdAt: string, read = false, level = 'INFO') => ({
  id,
  depotId: 'depot-1',
  title,
  body: `isi ${title}`,
  level,
  createdBy: 'm1',
  createdAt,
  read,
  readAt: null,
});
const hrNote = (id: string, title: string, publishedAt: string, read = false) => ({
  id,
  title,
  body: `isi ${title}`,
  level: 'WARNING',
  scheduledAt: null,
  publishedAt,
  audienceSize: 4,
  createdAt: publishedAt,
  targets: [],
  read,
});

let depotFeed: unknown = [];
let hrFeed: unknown = [];
let hrAnswered = false;
const answer = (v: unknown) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));

const draw = (el: React.ReactElement) => render(<LocaleProvider>{el}</LocaleProvider>);

beforeEach(() => {
  who.depotId = 'depot-1';
  hrAnswered = false;
  depotFeed = [broadcast('b1', 'Galon datang telat', '2026-11-19T01:00:00.000Z')];
  hrFeed = [hrNote('h1', 'Jadwal gajian maju', '2026-11-19T03:00:00.000Z')];
  post.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation((url: string) => {
    if (url === endpoints.broadcasts.forDepot('depot-1')) return answer(depotFeed);
    if (url === endpoints.hr.announcementsMe)
      return answer(hrFeed).finally(() => {
        hrAnswered = true;
      });
    if (url === endpoints.deliveries.shifts.current) return Promise.resolve({ id: 's1', status: 'ACTIVE' });
    if (url.includes('/performance')) return Promise.resolve({ delivered: 0, onTimeRate: 1 });
    return Promise.resolve({ items: [], total: 0, page: 1, limit: 20 });
  });
  localStorage.setItem(ONBOARDED_KEY, '1');
});
afterEach(() => vi.clearAllMocks());

describe('the courier inbox', () => {
  it("holds the depot's broadcasts and HR's announcements in one list, newest first, each saying who sent it", async () => {
    draw(<AnnouncementsPage />);
    const hr = await screen.findByText('Jadwal gajian maju');
    const depot = screen.getByText('Galon datang telat');
    // HR's (03:00) is newer than the depot's (01:00).
    expect(hr.compareDocumentPosition(depot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(new RegExp(A.fromHr))).toBeTruthy();
    expect(screen.getByText(new RegExp(A.fromDepot))).toBeTruthy();
  });

  it('marks a broadcast that arrives with a re-read (the app back from the background) too', async () => {
    draw(<AnnouncementsPage />);
    await waitFor(() => expect(post).toHaveBeenCalledWith(endpoints.broadcasts.read('b1'), {}, true));
    depotFeed = [
      broadcast('b2', 'Rute baru', '2026-11-19T05:00:00.000Z'),
      broadcast('b1', 'Galon datang telat', '2026-11-19T01:00:00.000Z', true),
    ];
    // Away for over a minute (useAsync's threshold), then back: every read runs again.
    let visibility = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      clock.mockReturnValue(now + 61_000);
      visibility = 'visible';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(await screen.findByText('Rute baru')).toBeTruthy();
      await waitFor(() =>
        expect(post).toHaveBeenCalledWith(endpoints.broadcasts.read('b2'), {}, true),
      );
      // And the one marked on open is not marked again.
      expect(post.mock.calls.filter(([u]) => u === endpoints.broadcasts.read('b1'))).toHaveLength(1);
    } finally {
      clock.mockRestore();
      delete (document as { visibilityState?: string }).visibilityState;
    }
  });

  it('marks the depot broadcasts read on open, and HR announcements only when the courier says so', async () => {
    const user = userEvent.setup();
    draw(<AnnouncementsPage />);
    await screen.findByText('Jadwal gajian maju');
    await waitFor(() => expect(post).toHaveBeenCalledWith(endpoints.broadcasts.read('b1'), {}, true));
    expect(post).not.toHaveBeenCalledWith(endpoints.hr.readAnnouncement('h1'), {}, true);

    const card = screen.getByText('Jadwal gajian maju').closest('div.rounded-2xl') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: idDict.hrFix.myAnnouncements.markRead2 }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(endpoints.hr.readAnnouncement('h1'), {}, true));
  });

  it('an account with no employee record (404 from HR) shows the depot list and no error', async () => {
    hrFeed = new ApiError(404, 'Akun ini belum tertaut ke data karyawan');
    draw(<AnnouncementsPage />);
    expect(await screen.findByText('Galon datang telat')).toBeTruthy();
    expect(screen.queryByText(/belum tertaut/)).toBeNull();
  });

  it('one source down does not blank the other: what was read is still shown', async () => {
    depotFeed = new ApiError(503, 'crm down');
    draw(<AnnouncementsPage />);
    expect(await screen.findByText('Jadwal gajian maju')).toBeTruthy();
    expect(screen.queryByText('Galon datang telat')).toBeNull();
    // The failed half says so, rather than reading as a depot that broadcast nothing.
    expect(screen.getByText(new RegExp(idDict.common.loadFailed))).toBeTruthy();
    expect(screen.getByRole('button', { name: idDict.common.retry })).toBeTruthy();
  });

  it('a courier with no depot yet still gets what HR sent', async () => {
    who.depotId = null;
    draw(<AnnouncementsPage />);
    expect(await screen.findByText('Jadwal gajian maju')).toBeTruthy();
    expect(screen.getByText(A.noDepotBody)).toBeTruthy();
  });

  it('says so when neither has anything', async () => {
    depotFeed = [];
    hrFeed = [];
    draw(<AnnouncementsPage />);
    expect(await screen.findByText(A.empty)).toBeTruthy();
  });
});

describe('the door to it on the courier home', () => {
  it('opens for an unread HR announcement even when the depot broadcast nothing', async () => {
    depotFeed = [];
    draw(<DriverHome />);
    const door = await screen.findByRole('link', { name: new RegExp(idDict.driver.home.announcements) });
    expect(door.getAttribute('href')).toBe('/driver/announcements');
  });

  it('opens for an HR announcement already read: the inbox is where it is read again', async () => {
    depotFeed = [];
    hrFeed = [hrNote('h1', 'Lama', '2026-11-01T00:00:00.000Z', true)];
    draw(<DriverHome />);
    expect(
      await screen.findByRole('link', { name: new RegExp(idDict.driver.home.announcements) }),
    ).toBeTruthy();
  });

  it('stays closed when neither has anything', async () => {
    depotFeed = [];
    hrFeed = [];
    draw(<DriverHome />);
    // Settled, not merely asked: the HR answer is in and rendered before the door is judged.
    await waitFor(() => expect(hrAnswered).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('link', { name: new RegExp(idDict.driver.home.announcements) })).toBeNull();
  });

  it('puts an urgent HR announcement in the red banner, as an urgent depot one is', async () => {
    depotFeed = [];
    hrFeed = [{ ...hrNote('h9', 'Absen besok wajib', '2026-11-19T04:00:00.000Z'), level: 'URGENT' }];
    draw(<DriverHome />);
    const banner = await screen.findByRole('link', { name: /Absen besok wajib/ });
    expect(banner.getAttribute('href')).toBe('/driver/announcements');
  });

  it('says so on the home when HR cannot be read, as it does for the depot', async () => {
    depotFeed = [];
    hrFeed = new ApiError(503, 'hr down');
    draw(<DriverHome />);
    expect(await screen.findByText(new RegExp(idDict.common.loadFailed))).toBeTruthy();
  });
});
