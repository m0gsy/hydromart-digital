import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * F9. The service worker matched an open window with `client.url.includes(url)` and focused
 * whatever it found.
 *
 * `includes` is a substring test on the WHOLE url, so `'/orders'` matched
 * `https://app/orders/detail?id=other-order`, and `'/'` — the fallback destination — matched
 * literally every open tab. So a notification about one order could focus a tab showing a
 * different one, and the destination it carried was then thrown away: `focus()` does not
 * navigate. The customer taps "pesananmu sudah sampai" and lands on whatever they had open.
 *
 * `sw.js` is not a module — it registers listeners on `self` — so it is loaded here into a
 * fake worker scope and the handler is invoked directly. That is also the only way to test
 * it at all: there is no import to reach.
 */

type Handler = (event: unknown) => void;

function loadSw() {
  const handlers = new Map<string, Handler>();
  const clients: { url: string; focused: boolean; navigated: string | null }[] = [];
  const opened: string[] = [];

  const scope = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    clients: {
      matchAll: vi.fn(async () =>
        clients.map((c) => ({
          url: c.url,
          focus: async () => {
            c.focused = true;
            return c;
          },
          navigate: async (to: string) => {
            c.navigated = to;
            return c;
          },
        })),
      ),
      openWindow: vi.fn(async (url: string) => {
        opened.push(url);
        return null;
      }),
    },
    registration: { showNotification: vi.fn() },
    skipWaiting: vi.fn(),
    location: { origin: 'https://app.test' },
  };

  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('self', src)(scope);
  return { handlers, clients, opened, scope };
}

function clickWith(url: string) {
  const waits: Promise<unknown>[] = [];
  return {
    notification: { close: vi.fn(), data: { url } },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
    settled: () => Promise.all(waits),
  };
}

describe('F9 — a notification opens what it is about', () => {
  let sw: ReturnType<typeof loadSw>;
  beforeEach(() => {
    sw = loadSw();
  });

  it('does not settle for a tab that merely CONTAINS the destination', async () => {
    // `'/orders'` is a substring of `/orders/detail?id=other`, so the old matcher focused
    // a tab showing somebody else's order and then threw the destination away — `focus()`
    // does not navigate.
    sw.clients.push({ url: 'https://app.test/orders/detail?id=other', focused: false, navigated: null });
    const ev = clickWith('/orders');
    sw.handlers.get('notificationclick')!(ev);
    await ev.settled();

    const wentSomewhere =
      sw.opened.includes('/orders') || sw.clients.some((c) => c.navigated === '/orders');
    expect(wentSomewhere).toBe(true);
  });

  it('does not treat "/" as a match for every open tab', async () => {
    sw.clients.push({ url: 'https://app.test/checkout', focused: false, navigated: null });
    const ev = clickWith('/');
    sw.handlers.get('notificationclick')!(ev);
    await ev.settled();

    const wentHome = sw.opened.includes('/') || sw.clients.some((c) => c.navigated === '/');
    expect(wentHome).toBe(true);
  });

  it('reuses a tab that is already on the exact destination', async () => {
    sw.clients.push({ url: 'https://app.test/orders/detail?id=mine', focused: false, navigated: null });
    const ev = clickWith('/orders/detail?id=mine');
    sw.handlers.get('notificationclick')!(ev);
    await ev.settled();

    expect(sw.clients[0]!.focused).toBe(true);
    expect(sw.opened).toHaveLength(0);
  });

  it('opens a window when nothing is open at all', async () => {
    const ev = clickWith('/rewards');
    sw.handlers.get('notificationclick')!(ev);
    await ev.settled();

    expect(sw.opened).toEqual(['/rewards']);
  });
});
