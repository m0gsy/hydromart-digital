/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * E5 — a transient failure used to kill a courier's queued punch permanently.
 *
 * `flush()` treated everything that was not status 0 or 401 as a final refusal: it wrote
 * `job.error`, and the loop skips any job carrying one. So a 502 from the gateway during a
 * deploy — the most ordinary failure this app has — marked a valid punch as rejected
 * forever, and only an operator noticing and discarding it by hand cleared it.
 *
 * A 4xx really is final: already checked in, outside the geofence, delivery already closed.
 * A 5xx is us, and it will be gone in a minute. They must not share a branch.
 *
 * Capture had the mirror-image bug: only status 0 was queued, so a 5xx thrown while
 * capturing propagated to the caller and the work was simply lost.
 */

const post = vi.fn();
class ApiError extends Error {
  constructor(
    public status: number,
    message = 'api',
  ) {
    super(message);
  }
}
vi.mock('@/lib/api', () => ({
  api: { post, get: vi.fn(), del: vi.fn() },
  ApiError,
  uploadFile: vi.fn(async () => ({ url: 'https://cdn/x.jpg' })),
}));
vi.mock('@/lib/session-store', () => ({ getSession: () => ({ customer: { id: 'cus_1' } }) }));
vi.mock('@/lib/app-lifecycle', () => ({ onResume: () => () => {} }));

const PUNCH = {
  kind: 'hrPunch' as const,
  payload: { mode: 'in' as const, image: 'data:image/jpeg;base64,AAAA', lat: 1, lng: 2 },
};

beforeEach(() => {
  post.mockReset();
  vi.resetModules();
  indexedDB.deleteDatabase('hm.offline');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a transient failure must not be final', () => {
  it('keeps a job retryable after a 502 and sends it on the next flush', async () => {
    const q = await import('@/lib/offline-queue');

    post.mockRejectedValueOnce(new ApiError(0)); // offline at capture → queued
    await q.runOrQueue(PUNCH);
    expect(q.pending()).toHaveLength(1);

    post.mockRejectedValueOnce(new ApiError(502)); // gateway restarting mid-deploy
    await q.flush();
    const [afterFail] = q.pending();
    expect(afterFail?.error, 'a 502 is not a refusal').toBeUndefined();
    expect(afterFail?.attempts).toBe(1);
    expect(afterFail?.nextAttemptAt, 'and it must wait before hammering again').toBeDefined();

    // Backoff is real, so an immediate flush leaves it alone.
    post.mockClear();
    await q.flush();
    expect(post).not.toHaveBeenCalled();

    post.mockResolvedValueOnce({});
    await q.flushNow();
    expect(q.pending(), 'the punch must eventually land').toHaveLength(0);
  });

  it('still marks a 4xx as final — that one really is a refusal', async () => {
    const q = await import('@/lib/offline-queue');
    post.mockRejectedValueOnce(new ApiError(0));
    await q.runOrQueue(PUNCH);

    post.mockRejectedValueOnce(new ApiError(409, 'Sudah absen masuk hari ini'));
    await q.flush();
    const [job] = q.pending();
    expect(job?.error).toBe('Sudah absen masuk hari ini');

    // And it is not retried: the operator discards it.
    post.mockClear();
    await q.flush();
    expect(post).not.toHaveBeenCalled();
  });

  it('queues a 5xx thrown at capture instead of losing the work', async () => {
    const q = await import('@/lib/offline-queue');
    post.mockRejectedValueOnce(new ApiError(503));
    const res = await q.runOrQueue(PUNCH);
    expect(res.outcome).toBe('queued');
    expect(q.pending()).toHaveLength(1);
  });

  it('still throws a 4xx at capture, so the courier is told', async () => {
    const q = await import('@/lib/offline-queue');
    post.mockRejectedValueOnce(new ApiError(422, 'Di luar geofence'));
    await expect(q.runOrQueue(PUNCH)).rejects.toThrow('Di luar geofence');
    expect(q.pending(), 'a refusal must not be queued as if it were captured').toHaveLength(0);
  });

  it('gives up after a bounded number of attempts rather than retrying forever', async () => {
    const q = await import('@/lib/offline-queue');
    post.mockRejectedValueOnce(new ApiError(0));
    await q.runOrQueue(PUNCH);

    for (let i = 0; i < q.MAX_ATTEMPTS + 2; i++) {
      post.mockRejectedValueOnce(new ApiError(500));
      await q.flushNow();
    }
    const [job] = q.pending();
    expect(job?.error, 'an endlessly failing job must become visible, not invisible').toBeDefined();
  });
});

describe('the queue does not grow without bound', () => {
  it('drops a job older than the retention window', async () => {
    // `shouldAdvanceTime`, or the IndexedDB promises never settle and this hangs.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    const q = await import('@/lib/offline-queue');
    post.mockRejectedValueOnce(new ApiError(0));
    await q.runOrQueue(PUNCH);
    expect(q.pending()).toHaveLength(1);

    // Well past the window. The payload holds a face frame; keeping it on a shared depot
    // phone forever is the part that matters, not the punch.
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    await q.flush();
    expect(q.pending()).toHaveLength(0);
  });
});
