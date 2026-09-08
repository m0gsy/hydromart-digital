import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * CA-4-50 — the courier's notification switches were write-only.
 *
 * `/driver/settings` stored them in `localStorage`; `sw.js`, the only code that decides
 * whether a notification is shown, cannot read `localStorage` — it has no window. Nothing
 * else read them either. So every switch on that screen, "Jangan ganggu" included, did
 * exactly nothing: a courier could turn the lot off and the phone rang the same.
 *
 * `lib/notif-prefs.ts` mirrors them into the Cache API, which the worker CAN read. These
 * tests drive the real `push` handler with a fake cache, and they also pin the two
 * deliberately conservative rules — unknown category always shows, and a delivery task
 * survives "Jangan ganggu" — because the failure that matters here is a missed assignment,
 * not one notification too many.
 *
 * `sw.js` is not a module, so it is loaded into a fake worker scope and the handler called
 * directly. There is no import to reach.
 */

type Handler = (event: unknown) => void;

/** `null` = nothing stored yet (cache miss); `undefined` = the cache itself throws. */
function loadSw(prefs: Record<string, boolean> | null | undefined, now: Date) {
  const handlers = new Map<string, Handler>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];

  const cache = {
    match: vi.fn(async (url: string) =>
      url === '/__notif-prefs' && prefs ? { json: async () => prefs } : undefined,
    ),
  };
  const caches =
    prefs === undefined
      ? { open: vi.fn(async () => { throw new Error('storage blocked'); }) }
      : { open: vi.fn(async () => cache) };

  const scope = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => null) },
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      }),
    },
    skipWaiting: vi.fn(),
    location: { origin: 'https://app.test' },
  };

  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  // The worker reads the wall clock for the quiet-hours window, so the clock is injected
  // too — otherwise these tests would pass or fail depending on the hour CI happens to run.
  const FakeDate = class extends Date {
    constructor(...args: unknown[]) {
      // @ts-expect-error - forwarding the real Date signature
      super(...(args.length ? args : [now.getTime()]));
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('self', 'caches', 'Date', src)(scope, caches, FakeDate);
  return { handlers, shown };
}

/** Runs the push handler to completion and reports what, if anything, was shown. */
async function push(
  prefs: Record<string, boolean> | null | undefined,
  url: string,
  hourLocal = 14,
): Promise<{ title: string }[]> {
  const now = new Date(2026, 8, 8, hourLocal, 0, 0);
  const { handlers, shown } = loadSw(prefs, now);
  let waited: Promise<unknown> = Promise.resolve();
  handlers.get('push')?.({
    data: { json: () => ({ title: 'Ada tugas', body: 'x', url }) },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
  return shown;
}

const TASK = '/driver/deliveries/detail?id=d1';
const PAYOUT = '/driver/earnings';
const PROMO = '/promo/lebaran';
const UNKNOWN = '/somewhere/new';

describe('CA-4-50 the courier notification switches actually decide', () => {
  it('shows everything when nothing is muted', async () => {
    expect(await push({ tasks: true, payout: true, promo: true, dnd: false }, PAYOUT)).toHaveLength(1);
  });

  it('drops a category the courier switched off', async () => {
    expect(await push({ payout: false }, PAYOUT)).toHaveLength(0);
    expect(await push({ promo: false }, PROMO)).toHaveLength(0);
  });

  it('leaves other categories alone when one is muted', async () => {
    expect(await push({ payout: false }, PROMO)).toHaveLength(1);
  });

  it('shows a URL it cannot classify, rather than guessing it away', async () => {
    // The payload carries no category, only a url. Silencing an unrecognised one could
    // silence a real assignment, so unknown always shows.
    expect(await push({ payout: false, promo: false, dnd: true }, UNKNOWN, 23)).toHaveLength(1);
  });

  it('silences non-task notifications inside "Jangan ganggu" hours', async () => {
    expect(await push({ dnd: true }, PAYOUT, 23)).toHaveLength(0);
    expect(await push({ dnd: true }, PAYOUT, 3)).toHaveLength(0);
    expect(await push({ dnd: true }, PAYOUT, 14)).toHaveLength(1);
  });

  it('still rings for a delivery task at night — that is the one thing DND must not eat', async () => {
    expect(await push({ dnd: true }, TASK, 23)).toHaveLength(1);
  });

  it('lets the courier turn tasks off explicitly, even though DND spares them', async () => {
    expect(await push({ tasks: false }, TASK, 14)).toHaveLength(0);
  });

  it('applies the screen defaults when nothing is stored yet', async () => {
    // A courier who has never opened the settings screen still SEES "Jangan ganggu" on,
    // because that is its default there. A cache miss has to mean the same thing, or the
    // screen and the phone disagree from the first day.
    expect(await push(null, PAYOUT, 23)).toHaveLength(0);
    expect(await push(null, PAYOUT, 14)).toHaveLength(1);
  });

  it('shows everything when the prefs cannot be read at all', async () => {
    // Storage blocked or quota gone: we know nothing, so we silence nothing. This is the
    // one case that must not be confused with the empty-set case above.
    expect(await push(undefined, PAYOUT, 23)).toHaveLength(1);
    expect(await push(undefined, PROMO, 23)).toHaveLength(1);
  });
});
