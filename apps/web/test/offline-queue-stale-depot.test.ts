// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api';

const post = vi.fn();

// Who is signed in and which depot their account belongs to now.
const session = vi.hoisted(() => ({ owner: 'courier-1' as string | null, assigned: 'depot-A' as string | null }));

vi.mock('../src/lib/session-store', () => ({
  getSession: () =>
    session.owner ? { customer: { id: session.owner, assignedDepotId: session.assigned } } : null,
  setSession: () => {},
  subscribe: () => () => {},
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { ...actual.api, post: (...a: unknown[]) => post(...a) }, uploadFile: vi.fn() };
});

async function freshQueue() {
  vi.resetModules();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('hm.offline');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  return import('../src/lib/offline-queue');
}

const gallon = {
  kind: 'gallonReturn' as const,
  payload: { depotId: 'depot-A', orderId: 'o1', quantity: 2, condition: 'GOOD' },
};
const checkIn = {
  kind: 'shiftCheckIn' as const,
  payload: { depotId: 'depot-A', lat: -6.2, lng: 106.8 },
};
const punch = {
  kind: 'hrPunch' as const,
  payload: { mode: 'in' as const, image: 'data:x', lat: -6.2, lng: 106.8 },
};

describe('a queued job captured at a depot the person no longer belongs to', () => {
  beforeEach(() => {
    post.mockReset();
    session.owner = 'courier-1';
    session.assigned = 'depot-A';
  });

  it('is marked with a plain reason and never sent', async () => {
    const { runOrQueue, flush, pending, STALE_DEPOT_MESSAGE } = await freshQueue();
    post.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await runOrQueue(gallon);
    expect(pending()).toHaveLength(1);

    session.assigned = 'depot-B'; // lent to another depot while the phone was offline
    post.mockReset();
    post.mockResolvedValue({});
    await flush();

    expect(post).not.toHaveBeenCalled();
    expect(pending()[0]!.error).toBe(STALE_DEPOT_MESSAGE);
    expect(STALE_DEPOT_MESSAGE).toMatch(/depot lain/);
  });

  it('applies to the shift check-in too', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await runOrQueue(checkIn);
    session.assigned = 'depot-B';
    post.mockReset();
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(pending()[0]!.error).toBeTruthy();
  });

  it('still sends when the depot is unchanged', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await runOrQueue(gallon);
    post.mockReset();
    post.mockResolvedValue({});
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(pending()).toHaveLength(0);
  });

  it('leaves a face punch alone: the server decides its depot from the day', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await runOrQueue(punch);
    session.assigned = 'depot-B';
    post.mockReset();
    post.mockResolvedValue({});
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(pending()).toHaveLength(0);
  });
});
