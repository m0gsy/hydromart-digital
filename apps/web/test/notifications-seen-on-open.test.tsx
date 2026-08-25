// @vitest-environment jsdom
/**
 * O4, the half a browser found: opening the inbox did not clear the badge.
 *
 * `useUnreadCount` renders "Notifikasi (30 belum dibaca)" in the nav and drops to nothing
 * when `markNotificationsSeen()` fires. That helper documents itself as "Called by the inbox
 * when it renders" — and it was not. The only caller was `markAllRead()`, behind a
 * "Tandai dibaca" button, so the badge sat at 9+ through every visit to the screen it points
 * at. Measured in a real browser against the live stack: open /notifications, wait for the
 * thirty rows to render, and `localStorage['hydromart.notifications.lastSeen']` is still
 * null with the bell still reading "(30 belum dibaca)"; click the button and both clear in
 * the same tick. So the mechanism worked and only the trigger was missing.
 *
 * The second assertion is the one that stops the naive fix. Rows highlight against the SAME
 * timestamp (`n.createdAt > lastSeen` — a tinted background and a dot), so marking seen by
 * moving the component's own `lastSeen` state would clear the badge and erase the highlight
 * on the very rows the user came to read. The fix has to write the storage key while keeping
 * the mount-time snapshot for rendering — which is why "the button is still offered" is
 * asserted here: it appears only while the snapshot still considers something unread.
 */
import { render, waitFor, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
let customer: { id: string; role: string } | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/notifications',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready: true }) }));

import NotificationsPage from '@/app/notifications/page';
import { LocaleProvider } from '@/lib/locale-context';
import { LAST_SEEN_KEY } from '@/lib/unread';

const ROW = {
  id: 'n1',
  event: 'ORDER_PLACED',
  message: 'Pesanan HM-1 sudah kami terima.',
  // Comfortably after any stored lastSeen, so this row is unread by definition.
  createdAt: '2026-08-25T12:00:00.000Z',
  readAt: null,
};

beforeEach(() => {
  localStorage.clear();
  get.mockReset().mockResolvedValue([ROW]);
  customer = { id: 'c1', role: 'CUSTOMER' };
});
afterEach(() => vi.clearAllMocks());

describe('O4 · opening the inbox is reading it', () => {
  it('stamps lastSeen once the feed has loaded, with nothing clicked', async () => {
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull();

    render(
      <LocaleProvider>
        <NotificationsPage />
      </LocaleProvider>,
    );

    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem(LAST_SEEN_KEY)).not.toBeNull());

    // Not before the rows arrive: a failed read must not mark unseen news as seen.
    const stamped = localStorage.getItem(LAST_SEEN_KEY) as string;
    expect(Date.parse(stamped)).not.toBeNaN();
  });

  it('keeps the mount-time snapshot, so the rows the visit was for stay marked unread', async () => {
    render(
      <LocaleProvider>
        <NotificationsPage />
      </LocaleProvider>,
    );

    await waitFor(() => expect(localStorage.getItem(LAST_SEEN_KEY)).not.toBeNull());
    // Offered only while the snapshot still sees something unread. If the fix moved the
    // component's own state instead of just the stored key, this button would be gone and
    // every row would have lost its highlight in the same tick.
    expect(screen.getByRole('button', { name: /tandai dibaca/i })).toBeTruthy();
  });

  it('does not stamp anything when the feed fails — silence is not "read"', async () => {
    get.mockReset().mockRejectedValue(new Error('offline'));

    render(
      <LocaleProvider>
        <NotificationsPage />
      </LocaleProvider>,
    );

    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
  });
});
