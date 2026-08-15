#!/usr/bin/env node
/**
 * Measure a screen INSIDE the installed APK, on a device or emulator.
 *
 * This exists because Playwright cannot: `connectOverCDP` wants a browser-level endpoint and
 * an Android WebView serves only `page` targets. So this speaks CDP over a raw WebSocket and
 * evaluates in the page — which is the only way to read what the WebView itself computed for
 * `env(safe-area-inset-*)`, the one number no desktop browser can answer for.
 *
 *   node scripts/apk-width-probe.mjs <appId> [route ...]
 *
 * Assumes the app is installed and `adb` is on PATH. It launches the app, forwards the
 * devtools socket, then for each route navigates and reports: document overflow at five
 * widths (set with `wm size`, because a WebView has no viewport to resize), the four
 * safe-area values, and any page error.
 *
 * `wm size`/`wm density` change the WHOLE device, so both are restored at the end — a probe
 * that leaves an emulator at 320x568 makes every later run lie.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
/** `--login <phone>` signs in through the UI first, so the routes measured have data on them. */
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const value = argv[i + 1] ?? null;
  argv.splice(i, value === null ? 1 : 2);
  return value;
};
const loginPhone = flag('--login');
const loginOtp = flag('--otp') ?? '424242';

const appId = argv[0];
if (!appId) {
  console.error(
    'usage: node scripts/apk-width-probe.mjs <appId> [--login <phone>] [--otp <code>] [route ...]',
  );
  process.exit(2);
}
const routes = argv.slice(1).length ? argv.slice(1) : ['/', '/products/'];

/**
 * `adb` is rarely on PATH — and a Git Bash PATH reaches node on Windows colon-separated,
 * which resolves nothing. `ANDROID_HOME` is the variable the SDK already sets.
 */
const ADB = process.env.ADB
  ? process.env.ADB
  : process.env.ANDROID_HOME
    ? `${process.env.ANDROID_HOME.replace(/[\\/]+$/, '')}/platform-tools/adb`
    : 'adb';
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8' }).trim();

/** Widths the app is held at, in dp. Density is pinned to 160 so px === dp. */
const WIDTHS = [320, 360, 390, 412, 428];

/**
 * Ask the bundle for the FILE, not the route — `/login/` becomes `/login/index.html`.
 *
 * Capacitor's local server runs with `server.html5mode` on (it defaults to true and nothing
 * here turns it off), and its SPA fallback fires for any request whose last path segment has
 * no dot in it: `WebViewLocalServer.handleLocalRequest` serves `index.html` and leaves the URL
 * alone. So a navigation to `/login/` inside the APK answers with the HOME document while
 * `location.pathname` still reads `/login/` — which is exactly the reading that was mistaken
 * for a stale install: fifteen routes, one document, ~300 chars each, no login form anywhere.
 * It reproduces on a freshly built bundle that demonstrably contains `login/index.html`.
 *
 * This costs the app nothing in practice — every real navigation is a client-side router push
 * (deep links included, `resolveDeepLink` hands the router a path), and Capacitor reloads
 * `appUrl` rather than the last URL after a process death, so no user ever issues one of these.
 * A probe does, and naming the file is the whole fix: a segment with a dot skips the fallback.
 */
function asFile(route) {
  const [path, query] = route.split('?');
  const suffix = query ? `?${query}` : '';
  if (path === '/' || path.endsWith('.html')) return route;
  return `${path.endsWith('/') ? path : `${path}/`}index.html${suffix}`;
}

async function devtoolsUrl() {
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
function cdp(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
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
    }
  });
  return {
    ready,
    send(method, params = {}) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const READ = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);' +
    'padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)';
  document.body.appendChild(probe);
  const p = getComputedStyle(probe);
  const bare = { top: p.paddingTop, bottom: p.paddingBottom, left: p.paddingLeft, right: p.paddingRight };
  probe.remove();
  return JSON.stringify({
    // The route, not the file it was fetched as — see \`asFile\`.
    path: location.pathname.replace(/index\\.html$/, ''),
    width: document.documentElement.clientWidth,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    chars: (document.body.innerText || '').trim().length,
    // \`ErrorState\` marks itself; see components/ui.tsx. A screen that failed to load has a
    // heading, a paragraph and a button, so counting characters calls it content and passes it.
    errored: !!document.querySelector('[data-state="error"]'),
    text: (document.body.innerText || '').trim().replace(/\\s+/g, ' '),
    bare,
    custom: {
      top: cs.getPropertyValue('--safe-area-inset-top').trim(),
      bottom: cs.getPropertyValue('--safe-area-inset-bottom').trim(),
    },
  });
})()`;

/**
 * A React-controlled input ignores `el.value = x` — React overwrites it on the next render.
 * The native setter plus a bubbling `input` event is what its `onChange` actually listens to.
 */
const TYPE = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'no-element';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    .call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`;

const evaluate = async (conn, expression) =>
  (await conn.send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;

/** Wait for a field to exist, then set it. */
async function fill(conn, selector, value, tries = 15) {
  for (let i = 0; i < tries; i++) {
    if ((await evaluate(conn, TYPE(selector, value))) === 'ok') return true;
    await sleep(1000);
  }
  return false;
}

/** Poll `location.pathname` — a navigation here is a whole new document, not a router push. */
async function until(conn, test, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const p = await evaluate(conn, 'location.pathname');
    if (typeof p === 'string' && test(p)) return p;
    await sleep(1000);
  }
  return null;
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
/**
 * Dismiss the first-run onboarding. On a fresh install it is a modal over EVERY route, so
 * without this the probe measures the same three slides 15 times and no form is reachable —
 * which is exactly what the first run of this looked like. The web sweeps set the same keys.
 */
async function skipOnboarding(conn) {
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

async function login(conn, phone, otp) {
  await evaluate(conn, `location.assign(${JSON.stringify(asFile('/login/'))})`);
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

const originalSize = adb('shell', 'wm', 'size');
const originalDensity = adb('shell', 'wm', 'density');
console.log(`device before: ${originalSize} | ${originalDensity}`);

adb('shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(6000);

const findings = [];
/**
 * Sign in ONCE for the whole run, not once per width.
 *
 * `POST /auth/login` is rate-limited to one OTP per phone per minute, so a login at every
 * width fails four times out of five with "Please wait 59s before requesting another code" —
 * and every route after it is then measured signed out, which is the exact failure this run
 * exists to avoid. The session survives the width changes for two reasons: the tokens live in
 * the Android Keystore rather than in the page, and `MainActivity` declares `screenSize` and
 * `density` in `configChanges`, so `wm size` does not restart the Activity or the WebView.
 *
 * It is re-armed when a route bounces to `/login`, so an expiry mid-run costs one width's
 * worth of readings rather than the rest of the sweep.
 */
let signedIn = false;
/** Rendered text -> the first route that produced it, per width. See the duplicate check below. */
let textSeen = new Map();
try {
  // px === dp, so a 320 here is the 320 the CSS sees.
  adb('shell', 'wm', 'density', '160');
  for (const width of WIDTHS) {
    adb('shell', 'wm', 'size', `${width}x800`);
    await sleep(2500);
    // Per width: the same route legitimately reads the same at 390 and 412dp.
    textSeen = new Map();
    const conn = cdp(await devtoolsUrl());
    await conn.ready;
    await conn.send('Runtime.enable');
    await skipOnboarding(conn);
    if (loginPhone && !signedIn) {
      const failed = await login(conn, loginPhone, loginOtp);
      console.log(`  login ${loginPhone}: ${failed ?? 'ok'}`);
      if (failed) findings.push(`login at ${width}dp: ${failed}`);
      signedIn = !failed;
    }
    for (const route of routes) {
      // The APK loads from a file/asset origin, so a route is a path under it; navigating by
      // `location.assign` keeps whatever origin the WebView already has.
      await conn.send('Runtime.evaluate', {
        expression: `location.assign(${JSON.stringify(asFile(route))})`,
      });
      // `location.assign` destroys the execution context, so the read has to wait for the new
      // one AND be prepared to find it not ready: the first attempt after a navigation
      // routinely comes back `undefined` rather than throwing.
      //
      // Taking the FIRST readable answer is not enough, and that is worth spelling out: a
      // client-fetched screen is readable the moment the shell paints, several seconds before
      // its data lands. Read that instant and `/orders/` measures 0 characters and no overflow —
      // a screen that looks broken and, worse, a width that looks safe because nothing was on it
      // yet. So keep reading until the same non-trivial length comes back twice, and keep the
      // last answer either way, so a screen that really is empty still reports as empty.
      //
      // THREE equal readings, not two. Two was not enough and the miss is instructive:
      // `/account/` settled at 33 characters — the avatar and the name — while the menu
      // beneath it was still arriving, because two consecutive polls happened to land inside
      // the same half-rendered moment. A screen measured half-rendered can hide an overflow
      // that only the finished layout has, which is the one thing these widths exist to find.
      let v = null;
      let previousChars = -1;
      let stable = 0;
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(1200);
        const res = await conn.send('Runtime.evaluate', { expression: READ, returnByValue: true });
        if (typeof res.result?.value !== 'string') continue;
        v = JSON.parse(res.result.value);
        stable = v.chars === previousChars ? stable + 1 : 0;
        if (v.chars >= 20 && stable >= 2) break;
        previousChars = v.chars;
      }
      if (!v) {
        console.log(`${String(width).padStart(4)} ${route.padEnd(24)} (no read)`);
        findings.push(`${route} at ${width}dp: page never became readable`);
        continue;
      }
      const line =
        `${String(width).padStart(4)} ${route.padEnd(24)} over=${String(v.over).padStart(4)} ` +
        `chars=${String(v.chars).padStart(5)} env(top)=${v.bare.top} env(bottom)=${v.bare.bottom} ` +
        `--top=${v.custom.top || '(unset)'} --bottom=${v.custom.bottom || '(unset)'}`;
      console.log(line);
      if (v.over > 0) findings.push(`${route} at ${width}dp: ${v.over}px overflow`);
      if (v.chars < 20) findings.push(`${route} at ${width}dp: rendered ${v.chars} chars`);
      if (v.errored)
        findings.push(`${route} at ${width}dp: error state — "${v.text.slice(0, 60)}"`);
      // Where it ACTUALLY ended up. A route that redirects was not measured, and saying so is
      // more use than the duplicate-text line it would otherwise produce: `/driver/shift/check-in/`
      // sends a courier who is already on shift to `/driver/`, which is correct behaviour and a
      // reading that does not exist. Reported either way — an unmeasured route is not a pass.
      const asked = route.split('?')[0];
      const landed = v.path?.endsWith('/') ? v.path : `${v.path}/`;
      if (landed !== asked) {
        findings.push(`${route} at ${width}dp: redirected to ${landed} — not measured`);
      } else {
        // Two different routes rendering the same words is always wrong, whatever the reason —
        // a shared failure card, an SPA fallback serving one document, a nav that never moved.
        // One map catches the whole class, including the ones nobody predicted.
        const seenAt = textSeen.get(v.text);
        if (seenAt && seenAt !== route)
          findings.push(`${route} at ${width}dp: identical text to ${seenAt}`);
        else textSeen.set(v.text, route);
      }
      // A route that answered from `/login` was measured without its data, which is the one
      // thing this run exists to avoid — so it counts, rather than passing quietly.
      if (loginPhone && /^\/(login|verify)/.test(v.path ?? '')) {
        findings.push(`${route} at ${width}dp: bounced to ${v.path} — measured with no data`);
        signedIn = false;
      }
    }
    conn.close();
  }
} finally {
  adb('shell', 'wm', 'size', 'reset');
  adb('shell', 'wm', 'density', 'reset');
  console.log('device size/density reset');
}

console.log(`\n${appId}: ${findings.length} finding(s)`);
for (const f of findings) console.log(`  ${f}`);
process.exit(findings.length ? 1 : 0);
