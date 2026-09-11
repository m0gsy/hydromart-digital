// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * A list screen handed the wrong shape must stay a list screen.
 *
 * `/hq/tickets` read its payload as an array and never checked. On an object payload
 * `(query.data ?? []).length` is `undefined`, so the empty branch is skipped and `.map`
 * runs on something that has none — an uncaught TypeError. Nothing between the page and
 * the root catches it, so `app/error.tsx` takes over and the WHOLE console becomes one
 * apology screen. One unexpected response shape, and the operator loses the page.
 *
 * The route itself is healthy: measured through the gateway with a real SUPER_ADMIN token,
 * `GET /admin/api/v1/tickets` answers `200 []`. This does not pin the server's shape — it
 * pins that a wrong one degrades to this screen's own error state, which is recoverable and
 * names itself, instead of to a dead console.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// Spread the real module rather than replace it: `useAsync` decides whether a rejection
// carries a server message with `e instanceof ApiError`, and a stand-in class fails that
// check — the screen would then show its generic line and the test would pass for the
// wrong reason. Only the two reads are swapped.
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/session-store', () => ({ getSession: () => ({ accountId: 'u1' }) }));
/*
 * NO `@/lib/depot-context` mock, and no `DepotProvider` around the page — deliberately.
 * That is exactly how /hq renders it: the HQ layout is network-scoped and mounts no depot
 * provider. The first version of this file mocked `useDepot`, and so passed while the real
 * page threw "useDepot must be used within <DepotProvider>" on every single visit.
 */

import { ApiError } from '@/lib/api';

import HqTicketsPage from '@/app/hq/tickets/page';

const DEPOTS = { items: [{ id: 'd-1', name: 'Depot Dago', code: 'BDG-01' }], total: 1, page: 1, limit: 100 };

/** Answer the depot read with a real page, and the ticket read with `tickets`. */
function answer(tickets: () => Promise<unknown>): void {
  get.mockImplementation((path: string) =>
    path.startsWith('/admin/api/v1/tickets') ? tickets() : Promise.resolve(DEPOTS),
  );
}

/*
 * Deliberately no `beforeEach` reset on `get`. Clearing the mock discards the stored result
 * of a call that returned a rejected promise, and the runner then reports that promise as an
 * escaped failure even though the page caught it and rendered the message — a red test with
 * a green screen behind it. Every test sets its own implementation, which replaces the last
 * one, so there is nothing left for a reset to do.
 */

describe('/hq/tickets survives a payload that is not a list', () => {
  /*
   * The paged `{rows,total}` envelope — the shape half this repo's list endpoints speak,
   * and the one that killed this page. `null` and a bare object stand in for a gateway
   * error body and a single-object response.
   */
  it.each([
    ['paged envelope', { rows: [], total: 0 }],
    ['bare object', { message: 'nope' }],
    ['a string', 'Service Unavailable'],
  ])('renders its own error state for %s, and does not throw', async (_label, payload) => {
    answer(() => Promise.resolve(payload));
    expect(() => render(<HqTicketsPage />)).not.toThrow();
    await waitFor(() => expect(screen.getByText('hq.tickets.loadError')).toBeTruthy());
  });

  it('still renders the list for the array the server actually sends', async () => {
    answer(() => Promise.resolve([
      {
        id: 't-1',
        subject: 'Galon bocor',
        status: 'OPEN',
        priority: 'HIGH',
        createdAt: new Date().toISOString(),
        depotRef: 'd-1',
        messages: [],
      },
    ]));
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText('Galon bocor')).toBeTruthy());
    // The depot's NAME, which needs the network depot read to have worked without a provider.
    await waitFor(() => expect(screen.getAllByText('Depot Dago').length).toBeGreaterThan(0));
  });

  /*
   * A failed read must say WHY. The screen used to answer every failure with one generic
   * line, so a 403 naming a missing capability and a 502 from a service that is down were
   * indistinguishable on screen — and a bug report could only say "it errored".
   */
  it('shows the message the server actually sent, not a generic one', async () => {
    answer(() => Promise.reject(new ApiError(403, 'Anda tidak punya akses ke tiket')));
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText('Anda tidak punya akses ke tiket')).toBeTruthy());
    expect(screen.queryByText('hq.tickets.loadError')).toBeNull();
  });

  it('renders the empty state for an empty list, not the error state', async () => {
    answer(() => Promise.resolve([]));
    render(<HqTicketsPage />);
    await waitFor(() => expect(screen.getByText('hq.tickets.empty')).toBeTruthy());
    expect(screen.queryByText('hq.tickets.loadError')).toBeNull();
  });
});
