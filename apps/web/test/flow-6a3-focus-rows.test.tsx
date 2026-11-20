// @vitest-environment jsdom
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Flow 6a-3 (plan PR-6): the destinations #984 sends carry `?id=`, and the screens they open
 * now land on that row: scrolled into view and marked, not the top of an unfiltered list.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn() } };
});
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const who = vi.hoisted(() => ({ role: 'HR' }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: who.role }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr/me',
  useSearchParams: () => new URLSearchParams(),
}));

import LeaveQueuePage from '@/app/hr/leave/page';
import MyAnnouncementsPage from '@/app/hr/me/announcements/page';
import { focusRowId, useFocusRow } from '@/lib/use-focus-row';
import MyLeavePage from '@/app/hr/me/leave/page';

const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  } as never;
});
afterEach(() => {
  get.mockReset();
  window.history.replaceState(null, '', '/');
});

const announcement = (id: string) => ({
  id,
  title: `Judul ${id}`,
  body: 'isi',
  level: 'INFO',
  read: true,
  publishedAt: '2026-11-19T03:00:00.000Z',
});

describe('a notification opens its row', () => {
  it('an announcement push lands on that announcement', async () => {
    get.mockResolvedValue([announcement('a-1'), announcement('a-2')]);
    window.history.replaceState(null, '', '/hr/me/announcements?id=a-2');
    render(<MyAnnouncementsPage />);
    await screen.findByText('Judul a-2');
    await waitFor(() => expect(scrolled).toEqual(['row-a-2']));
    expect(document.getElementById('row-a-2')?.getAttribute('aria-current')).toBe('true');
    expect(document.getElementById('row-a-1')?.getAttribute('aria-current')).toBeNull();
  });

  it('a leave decision push lands on that request', async () => {
    const request = (id: string) => ({
      id,
      type: 'ANNUAL',
      status: 'APPROVED',
      startDate: '2026-11-24',
      endDate: '2026-11-25',
      days: 2,
      reason: 'x',
    });
    get.mockImplementation(async (url: string) =>
      url.includes('balance')
        ? { annual: 12, used: 2, remaining: 10 }
        : { rows: [request('l-1'), request('l-2')], total: 2, page: 1, pageSize: 50 },
    );
    window.history.replaceState(null, '', '/hr/me/leave?id=l-1');
    render(<MyLeavePage />);
    await waitFor(() => expect(scrolled).toEqual(['row-l-1']));
    expect(document.getElementById('row-l-1')?.getAttribute('aria-current')).toBe('true');
  });

  // Review: HR's queue opens on HR's own stage, where a NEW request (waiting on the manager)
  // is not; a request a push names is shown whatever its stage.
  it("HR's leave queue opened from a push shows the request whatever its stage", async () => {
    who.role = 'HR';
    get.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    window.history.replaceState(null, '', '/hr/leave?id=l-9');
    render(<LeaveQueuePage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    const url = new URL(String(get.mock.calls[0]![0]), 'http://x');
    expect(url.searchParams.get('status')).toBeNull();

    get.mockClear();
    window.history.replaceState(null, '', '/hr/leave');
    render(<LeaveQueuePage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(new URL(String(get.mock.calls[0]![0]), 'http://x').searchParams.get('status')).toBe('PENDING_HR');
  });

  // Review: a reload or "load more" must not pull the reader back to the row every time.
  it('scrolls to the row once, not on every render after', () => {
    window.history.replaceState(null, '', '/x?id=r-1');
    const row = document.createElement('div');
    row.id = focusRowId('r-1');
    document.body.appendChild(row);
    const { rerender } = renderHook(() => useFocusRow());
    rerender();
    rerender();
    expect(scrolled).toEqual(['row-r-1']);
    row.remove();
  });

  it('leaves the list alone without an id', async () => {
    get.mockResolvedValue([announcement('a-1')]);
    render(<MyAnnouncementsPage />);
    await screen.findByText('Judul a-1');
    expect(scrolled).toEqual([]);
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });
});
