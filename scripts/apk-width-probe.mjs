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
import { setTimeout as sleep } from 'node:timers/promises';

import { adb, cdp, devtoolsUrl, goto, login, skipOnboarding } from './lib/apk-cdp.mjs';

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

/** Widths the app is held at, in dp. Density is pinned to 160 so px === dp. */
const WIDTHS = [320, 360, 390, 412, 428];

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
    const conn = cdp(await devtoolsUrl(appId));
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
      // `location.assign` keeps whatever origin the WebView already has. `goto` also stops the
      // file name from reaching `usePathname()`, which used to make every screen measured here
      // render its `pushed` chrome instead of its own — see `goto` in lib/apk-cdp.mjs.
      await goto(conn, route);
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
