// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Flow 6a-2 (plan PR-6, web half).
 * - An approval push names the manager's PHONE console; in a browser it opens on the depot
 *   console (`/dashboard/approvals`). A binary keeps the phone route.
 * - A feed row links only to a screen this reader's role may open.
 * - A depot alert's `?depot=` selects that depot, so an overseer opens the right one.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});

import { resolveDeepLink } from '@/lib/deep-link';
import { DepotProvider, useDepot } from '@/lib/depot-context';
import { feedHref, pushTarget } from '@/lib/notification-access';

afterEach(() => {
  get.mockReset();
  window.history.replaceState(null, '', '/');
});

describe('the approval notification on the desktop console', () => {
  it("opens on the depot console from the desktop feed, and nowhere else changes", () => {
    expect(feedHref('/m/manager/approvals/detail?id=a-1', 'MANAGER', true)).toBe(
      '/dashboard/approvals/detail?id=a-1',
    );
    expect(feedHref('/m/manager/approvals?x=1', 'MANAGER', true)).toBe('/dashboard/approvals?x=1');
    // The phone console's own feed, and a sibling that only shares the prefix, stay put.
    expect(feedHref('/m/manager/approvals/detail?id=a-1', 'MANAGER')).toBe(
      '/m/manager/approvals/detail?id=a-1',
    );
    expect(feedHref('/m/manager/approvalsx', 'MANAGER', true)).toBe('/m/manager/approvalsx');
    // A login `next` back to the phone console is not a notification: it is not twinned.
    expect(resolveDeepLink('/m/manager/approvals')).toBe('/m/manager/approvals');
  });
});

describe('a push tap for a role refused its screen', () => {
  it("lands on the reader's own feed; an allowed one lands on the screen", () => {
    expect(pushTarget('/dashboard/meter?depot=d-1', 'CUSTOMER')).toBe('/notifications');
    expect(pushTarget('/hr/me/leave?id=l-1', 'MANAGER')).toBe('/hr/me/leave?id=l-1');
    expect(pushTarget('/orders/detail?id=o-1', null)).toBe('/orders/detail?id=o-1');
  });
});

describe('a feed row links only where its reader may go', () => {
  it('drops the link for a role refused the screen, and keeps it for one allowed', () => {
    expect(feedHref('/hr/me/leave?id=l-1', 'CUSTOMER')).toBeNull();
    expect(feedHref('/hr/me/leave?id=l-1', 'MANAGER')).toBe('/hr/me/leave?id=l-1');
    // Without a reader, as before.
    expect(feedHref('/hr/me/leave?id=l-1', undefined)).toBe('/hr/me/leave?id=l-1');
  });
});

function Selected() {
  const { selectedId } = useDepot();
  return <p>selected:{selectedId ?? 'none'}</p>;
}

describe('?depot= on a depot alert', () => {
  it('selects the named depot when it is in scope, then leaves the URL', async () => {
    get.mockResolvedValue([
      { id: 'd-a', name: 'A', code: 'A' },
      { id: 'd-b', name: 'B', code: 'B' },
    ]);
    window.history.replaceState(null, '', '/dashboard/meter?depot=d-b');
    render(
      <DepotProvider>
        <Selected />
      </DepotProvider>,
    );
    await waitFor(() => expect(screen.getByText('selected:d-b')).toBeTruthy());
    expect(window.location.search).toBe('');
  });

  it('keeps the request through a failed list read, and applies it on the retry', async () => {
    get.mockRejectedValueOnce(new Error('503')).mockResolvedValue([
      { id: 'd-a', name: 'A', code: 'A' },
      { id: 'd-b', name: 'B', code: 'B' },
    ]);
    window.history.replaceState(null, '', '/dashboard/meter?depot=d-b');
    function Retry() {
      const { error, reload, selectedId } = useDepot();
      return (
        <>
          <p>selected:{selectedId ?? 'none'}</p>
          {error && <button onClick={reload}>retry</button>}
        </>
      );
    }
    render(
      <DepotProvider>
        <Retry />
      </DepotProvider>,
    );
    const retry = await screen.findByText('retry');
    expect(window.location.search).toBe('?depot=d-b');
    retry.click();
    await waitFor(() => expect(screen.getByText('selected:d-b')).toBeTruthy());
  });

  it('ignores a depot outside the reader’s scope', async () => {
    get.mockResolvedValue([{ id: 'd-a', name: 'A', code: 'A' }]);
    window.history.replaceState(null, '', '/dashboard/meter?depot=d-x');
    render(
      <DepotProvider>
        <Selected />
      </DepotProvider>,
    );
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByText('selected:d-x')).toBeNull();
  });
});
