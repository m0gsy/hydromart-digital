// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api';

const post = vi.fn();
const upload = vi.fn();

// Who is signed in, for the H-24 owner binding. Hoisted so the module mock below can read
// it after each vi.resetModules() in freshQueue().
const session = vi.hoisted(() => ({ owner: 'courier-1' as string | null }));

vi.mock('../src/lib/session-store', () => ({
  getSession: () => (session.owner ? { customer: { id: session.owner } } : null),
  setSession: () => {},
  subscribe: () => () => {},
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return {
    ...actual,
    api: { ...actual.api, post: (...a: unknown[]) => post(...a) },
    uploadFile: (...a: unknown[]) => upload(...a),
  };
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

const punch = {
  kind: 'hrPunch' as const,
  payload: { mode: 'in' as const, image: 'data:x', lat: -6.2, lng: 106.8 },
};

/** Pretend `who` is signed in on this device. */
function signIn(who: string | null): void {
  session.owner = who;
}

describe('offline queue', () => {
  beforeEach(() => {
    post.mockReset();
    upload.mockReset();
    signIn('courier-1');
  });

  // H-24: a depot phone is shared. A punch queued offline by one courier used to flush
  // under whoever signed in next — the server resolves the employee from the token, so
  // one person's face frame filed the other person's attendance.
  it('does not send, or even show, a job the signed-in user did not capture', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValue(new ApiError(0, 'offline'));
    await runOrQueue(punch);
    expect(pending()).toHaveLength(1);

    signIn('courier-2');
    post.mockReset();
    post.mockResolvedValue({ id: 'a1' });
    await flush();

    expect(post).not.toHaveBeenCalled();
    expect(pending()).toHaveLength(0);

    // It is held, not lost: the courier who captured it signs back in and it goes.
    signIn('courier-1');
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(pending()).toHaveLength(0);
  });

  it('sends straight through when the network is there, adding the capture time', async () => {
    const { runOrQueue, pending } = await freshQueue();
    post.mockResolvedValue({ id: 'a1', status: 'PRESENT' });

    const sent = await runOrQueue<{ id: string }>(punch);

    expect(sent).toEqual({ outcome: 'sent', result: { id: 'a1', status: 'PRESENT' } });
    expect(post.mock.calls[0]![1]).toMatchObject({ image: 'data:x', lat: -6.2 });
    expect(typeof post.mock.calls[0]![1].capturedAt).toBe('string');
    // The wire payload carries no `mode` — that only chooses the endpoint.
    expect(post.mock.calls[0]![1]).not.toHaveProperty('mode');
    expect(pending()).toHaveLength(0);
  });

  it('queues the job when the device is offline', async () => {
    const { runOrQueue, pending } = await freshQueue();
    post.mockRejectedValue(new ApiError(0, 'Cannot reach the server.'));

    await expect(runOrQueue(punch)).resolves.toEqual({ outcome: 'queued' });
    expect(pending()).toHaveLength(1);
    expect(pending()[0]!.kind).toBe('hrPunch');
  });

  // A 401 at capture time is a lapsed session, not a lost network. Queuing it silently
  // left the courier tapping a button that appeared to do nothing; it has to reach them.
  it('surfaces a 401 instead of hiding a lapsed session in the queue', async () => {
    const { runOrQueue, pending } = await freshQueue();
    post.mockRejectedValue(new ApiError(401, 'Unauthorized'));

    await expect(runOrQueue(punch)).rejects.toThrow('Unauthorized');
    expect(pending()).toHaveLength(0);
  });

  // ...but a job already captured offline is still valid work: flush must hold it for the
  // next sign-in rather than burning it.
  it('flush keeps a queued job when the session has lapsed', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await runOrQueue(punch);

    post.mockRejectedValue(new ApiError(401, 'Unauthorized'));
    await flush();

    expect(pending()).toHaveLength(1);
    expect(pending()[0]!.error).toBeUndefined();
  });

  it('lets a real rejection through instead of hiding it in the queue', async () => {
    const { runOrQueue, pending } = await freshQueue();
    post.mockRejectedValue(new ApiError(400, 'Sudah check-in hari ini'));

    await expect(runOrQueue(punch)).rejects.toThrow('Sudah check-in hari ini');
    expect(pending()).toHaveLength(0);
  });

  it('flush replays a queued job with its original capture time and clears it', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await runOrQueue(punch);
    const queuedAt = pending()[0]!.capturedAt;

    post.mockResolvedValue({ id: 'a1' });
    await flush();

    expect(post.mock.calls.at(-1)?.[1]?.capturedAt).toBe(queuedAt);
    expect(pending()).toHaveLength(0);
  });

  it('keeps the job when flush finds the network still down', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValue(new ApiError(0, 'offline'));
    await runOrQueue(punch);

    await flush();

    expect(pending()).toHaveLength(1);
    expect(pending()[0]!.error).toBeUndefined();
  });

  it('marks a rejected job with the server message and never retries it', async () => {
    const { runOrQueue, flush, pending } = await freshQueue();
    post.mockRejectedValueOnce(new ApiError(0, 'offline'));
    await runOrQueue(punch);

    post.mockRejectedValue(new ApiError(400, 'Absen offline sudah terlalu lama.'));
    await flush();
    expect(pending()[0]!.error).toBe('Absen offline sudah terlalu lama.');

    const callsAfterReject = post.mock.calls.length;
    await flush();
    expect(post.mock.calls.length).toBe(callsAfterReject);
  });

  it('discards a job on request', async () => {
    const { runOrQueue, discard, pending } = await freshQueue();
    post.mockRejectedValue(new ApiError(0, 'offline'));
    await runOrQueue(punch);

    await discard(pending()[0]!.id);

    expect(pending()).toHaveLength(0);
  });

  it('uploads a queued proof photo before completing the delivery', async () => {
    const { runOrQueue } = await freshQueue();
    upload.mockResolvedValue({ url: 'https://cdn/p.jpg' });
    post.mockResolvedValue({ id: 'del-1' });

    await runOrQueue({
      kind: 'pod',
      payload: {
        deliveryId: 'del-1',
        orderNumber: 'HM-1',
        photo: 'data:image/jpeg;base64,/9j/4AAQ',
        recipientName: 'Budi',
        latitude: -6.2,
        longitude: 106.8,
      },
    });

    expect(upload).toHaveBeenCalledTimes(1); // no signature drawn
    expect(post.mock.calls[0]![1]).toMatchObject({
      photoUrl: 'https://cdn/p.jpg',
      signatureUrl: undefined,
      recipientName: 'Budi',
    });
  });

  /**
   * The only automatic trigger used to be the `online` event, which an Android WebView
   * reports through `navigator.onLine` and cannot be relied on, plus the queue banner
   * mounting — which happens once, because it lives in the driver layout and moving
   * between courier screens does not remount it. A courier who regained signal while
   * sitting on the same screen sent nothing.
   */
  it('flushes when the app comes back to the front', async () => {
    const queue = await freshQueue();
    post.mockRejectedValue(new ApiError(0, 'offline'));
    await queue.runOrQueue(punch);
    expect(queue.pending()).toHaveLength(1);

    post.mockReset();
    post.mockResolvedValue({ id: 'att-1' });
    // What `app-lifecycle` listens to; in the shell `appStateChange` fires alongside it.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    await vi.waitFor(() => expect(queue.pending()).toHaveLength(0));
  });

  it('survives a reload: a queued job is read back from IndexedDB', async () => {
    const first = await freshQueue();
    post.mockRejectedValue(new ApiError(0, 'offline'));
    await first.runOrQueue(punch);

    // Same origin, new module instance — as after a page refresh.
    vi.resetModules();
    const reloaded = await import('../src/lib/offline-queue');
    const restored = await reloaded.hydrate();

    expect(restored).toHaveLength(1);
    expect(restored[0]!.kind).toBe('hrPunch');
  });
});
