/**
 * Talking to the page inside an installed Android APK.
 *
 * Extracted from `scripts/apk-width-probe.mjs` when a second caller appeared
 * (`scripts/apk-device-checklist.mjs`). Nothing here is new — the comments are the findings
 * that produced each function, and they are the reason this is a shared file rather than a
 * second copy: every one of them was paid for once already.
 *
 * Playwright cannot do this. `connectOverCDP` wants a browser-level endpoint and an Android
 * WebView serves only `page` targets, so this speaks CDP over a raw WebSocket.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * `adb` is rarely on PATH — and a Git Bash PATH reaches node on Windows colon-separated,
 * which resolves nothing. `ANDROID_HOME` is the variable the SDK already sets.
 */
const ADB = process.env.ADB
  ? process.env.ADB
  : process.env.ANDROID_HOME
    ? `${process.env.ANDROID_HOME.replace(/[\\/]+$/, '')}/platform-tools/adb`
    : 'adb';

export const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8' }).trim();

/** Same, but a non-zero exit is an answer rather than a throw (`pidof` on a dead app). */
export const adbTry = (...args) => {
  try {
    return adb(...args);
  } catch (e) {
    return e.stdout?.toString().trim() ?? '';
  }
};

/**
 * Ask the bundle for the FILE, not the route — `/login/` becomes `/login/index.html`.
 *
 * Capacitor's local server runs with `server.html5mode` on (it defaults to true and nothing
 * here turns it off), and its SPA fallback fires for any request whose last path segment has
 * no dot in it: `WebViewLocalServer.handleLocalRequest` serves `index.html` and leaves the URL
 * alone. So a navigation to `/login/` inside the APK answers with the HOME document while
 * `location.pathname` still reads `/login/` — which is exactly the reading that was mistaken
 * for a stale install: fifteen routes, one document, ~300 chars each, no login form anywhere.
 *
 * This costs the app nothing in practice — every real navigation is a client-side router push
 * (deep links included, `resolveDeepLink` hands the router a path), and Capacitor reloads
 * `appUrl` rather than the last URL after a process death, so no user ever issues one of these.
 * A probe does, and naming the file is the whole fix: a segment with a dot skips the fallback.
 *
 * Naming the file is only HALF the fix, and the other half is `goto()` below. See its comment:
 * the document is right, the pathname the app then reads is not.
 */
export function asFile(route) {
  const [path, query] = route.split('?');
  const suffix = query ? `?${query}` : '';
  if (path === '/' || path.endsWith('.html')) return route;
  return `${path.endsWith('/') ? path : `${path}/`}index.html${suffix}`;
}

/** `/products/index.html` -> `/products/`. The route the file was prerendered for. */
export function routePathname(pathname) {
  return pathname.endsWith('/index.html')
    ? pathname.slice(0, -'index.html'.length)
    : pathname;
}

/**
 * Runs in every new document BEFORE its bundle, so `usePathname()` never sees the file name.
 *
 * `asFile()` fetches the right document and leaves `location.pathname` reading
 * `/products/index.html`. Nothing in the app normalises that: `screen-chrome.ts` looks the
 * path up in its route table, misses, and calls the screen `pushed` — so the client renders a
 * back chevron and no tab bar over static HTML that was prerendered as `root`, with a search
 * bar and a tab bar. React 19 calls that an HTML hydration mismatch (error #418), throws away
 * the server tree and rebuilds the whole root on the client.
 *
 * That is the ~10 #418s per probe run, measured and then measured away on an emulator: 0 on
 * the launch document `/`, 2 per `…/index.html` load, 0 again with this installed. No user
 * ever loads one of those URLs, so this was never an app bug — it was the probe changing what
 * it was measuring. Every reading taken through `asFile()` before this was taken on the wrong
 * chrome, after a full client re-render that also wiped the plugin's `--safe-area-inset-*`
 * off `<html>`.
 */
export const PATH_FIX = `if (location.pathname.endsWith('/index.html')) history.replaceState(history.state, '', location.pathname.slice(0, -'index.html'.length) + location.search + location.hash);`;

const patched = new WeakSet();

/** Navigate to a route the way a probe has to, without lying to the app about where it is. */
export async function goto(conn, route) {
  if (!patched.has(conn)) {
    patched.add(conn);
    await conn.send('Page.enable');
    await conn.send('Page.addScriptToEvaluateOnNewDocument', { source: PATH_FIX });
  }
  await evaluate(conn, `location.assign(${JSON.stringify(asFile(route))})`);
}

export async function devtoolsUrl(appId) {
  const pid = adb('shell', 'pidof', appId);
  if (!pid) throw new Error(`${appId} is not running`);
  adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 20; i++) {
    try {
      // Plain HTTP on purpose and unavoidable: this is the Chrome DevTools socket that `adb
      // forward` exposes on loopback. It serves HTTP only, it is reachable from this machine
      // alone, and it carries no credential — the alternative is not measuring inside the APK.
      // The marker has to sit on the line directly above the finding; a comment in between
      // silently detaches it, which is how this rule stayed red for four commits.
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* the socket is not up yet */
    }
    await sleep(500);
  }
  throw new Error('no CDP page target');
}

/** One CDP connection, request/response by id. */
export function cdp(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Set();
  let next = 1;
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(new Error(`ws error: ${e.message ?? 'unknown'}`)));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (slot) {
      pending.delete(msg.id);
      msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
      return;
    }
    if (msg.method) for (const fn of listeners) fn(msg);
  });
  return {
    ready,
    send(method, params = {}) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        // A `location.assign` destroys the execution context that owed us this reply, and
        // then nothing ever answers: the process ends on "unsettled top-level await" with no
        // output at all. A lost reply has to look like `undefined`, not like a hang.
        // NOT unref'd: an unref'd timer lets node exit the moment the socket dies, which
        // turns the lost reply back into the same "unsettled top-level await" it was added
        // to prevent — just faster.
        setTimeout(() => {
          if (pending.delete(id)) resolve({});
        }, 8_000);
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    /** CDP events (`Log.entryAdded`, `Page.frameNavigated`, …). Returns an unsubscribe. */
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close: () => ws.close(),
  };
}

/**
 * A React-controlled input ignores `el.value = x` — React overwrites it on the next render.
 * The native setter plus a bubbling `input` event is what its `onChange` actually listens to.
 */
export const TYPE = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'no-element';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    .call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`;

export const evaluate = async (conn, expression) =>
  (await conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.value;

/** Wait for a field to exist, then set it. */
export async function fill(conn, selector, value, tries = 15) {
  for (let i = 0; i < tries; i++) {
    if ((await evaluate(conn, TYPE(selector, value))) === 'ok') return true;
    await sleep(1000);
  }
  return false;
}

/** Poll `location.pathname` — a navigation here is a whole new document, not a router push. */
export async function until(conn, test, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const p = await evaluate(conn, 'location.pathname');
    if (typeof p === 'string' && test(p)) return p;
    await sleep(1000);
  }
  return null;
}

/**
 * Dismiss the first-run onboarding. On a fresh install it is a modal over EVERY route, so
 * without this the probe measures the same three slides 15 times and no form is reachable —
 * which is exactly what the first run of this looked like. The web sweeps set the same keys.
 */
export async function skipOnboarding(conn) {
  await evaluate(
    conn,
    `(() => {
      localStorage.setItem('hydromart.onboarded', '1');
      localStorage.setItem('hydromart_driver_onboarded', '1');
      localStorage.setItem('hydromart.locale', 'id');
      return 'ok';
    })()`,
  );
}

/**
 * Sign in the way a person does: the phone screen, then the OTP screen.
 *
 * Not by injecting a token. On native the tokens live in the Android Keystore
 * (`token-store.ts`), so there is no storage for a probe to write — and driving the real
 * screens is the only version of this that also proves login itself works inside the APK.
 *
 * Returns null on success, or the reason it stopped.
 */
export async function login(conn, phone, otp) {
  await goto(conn, '/login/');
  if (!(await until(conn, (p) => p.startsWith('/login')))) return 'never reached /login';
  // The document exists well before React has hydrated it, so the field is waited for rather
  // than asked about once — a single miss here reads as "this screen has no login form".
  if (!(await fill(conn, '#phone', phone))) return 'no phone field';
  await evaluate(conn, `document.querySelector('#phone').closest('form').requestSubmit()`);
  if (!(await until(conn, (p) => p.startsWith('/verify')))) return 'OTP was never requested';
  // One box takes the whole code: `otp-input.tsx` spreads the digits across the rest and
  // fires `onComplete`, the same path a paste takes.
  if (!(await fill(conn, 'input[inputmode="numeric"]', otp))) return 'no OTP field';
  const landed = await until(conn, (p) => !p.startsWith('/verify') && !p.startsWith('/login'), 25);
  return landed ? null : 'OTP was not accepted';
}
