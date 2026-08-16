#!/usr/bin/env node
/**
 * The "prove it on a real Android device" list from `docs/MOBILE_APPS_PLAN.md`, driven.
 *
 *   node scripts/apk-device-checklist.mjs <appId> --login <phone> [--items 2,5,8,10]
 *
 * Each item answers one question the plan says only a device can answer, and each one
 * reports the reading it based that answer on — a PASS with no number under it is the
 * failure mode this whole exercise exists to avoid.
 *
 * Items that are not here are not oversights; see the report in the session notes:
 *   3  needs a WebView older than 111, which no stock system image ships
 *   4  is a build-time fact, already answered by the APK containing `assets/public`
 *   7  needs `google-services.json`, which lives only in CI (`GOOGLE_SERVICES_JSON_BASE64`)
 *   11 needs an enrolled fingerprint; driven by hand, not from here
 */
import { setTimeout as sleep } from 'node:timers/promises';

import {
  adb,
  adbTry,
  cdp,
  devtoolsUrl,
  evaluate,
  goto,
  login,
  skipOnboarding,
  TYPE,
  until,
  viewportTop,
} from './lib/apk-cdp.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const value = argv[i + 1] ?? fallback;
  argv.splice(i, 2);
  return value;
};
const loginPhone = flag('--login');
const loginOtp = flag('--otp', '424242');
const only = (flag('--items') ?? '').split(',').filter(Boolean);
const appId = argv[0];
if (!appId) {
  console.error('usage: node scripts/apk-device-checklist.mjs <appId> --login <phone> [--items …]');
  process.exit(2);
}

const results = [];
const record = (id, title, verdict, evidence) => {
  results.push({ id, title, verdict, evidence });
  console.log(`\n[${id}] ${title}\n  ${verdict}\n${evidence.map((e) => `    ${e}`).join('\n')}`);
};

/** The foreground activity, which is how a native screen (chooser, camera, share) is seen. */
const resumedActivity = () => {
  // `mResumedActivity` is gone on Android 16; `mCurrentFocus` is present on every version
  // here and, unlike the activity list, also names a chooser or share sheet on top.
  const dump = adbTry('shell', 'dumpsys', 'window');
  return /mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/.exec(dump)?.[1] ?? '(none)';
};

/** `mInputShown` is the only honest answer to "is the soft keyboard up". */
const keyboardShown = () => /mInputShown=true/.test(adbTry('shell', 'dumpsys', 'input_method'));

/**
 * The top edge of the keyboard, in screen pixels — the only number that can answer this on
 * Android 15+, where an edge-to-edge activity is no longer resized for the IME and the page's
 * own viewport therefore never learns the keyboard is there. Reading `visualViewport` alone
 * makes every screen look safe.
 */
function imeTop() {
  // The `InputMethod` WINDOW is full-height and its frame says nothing about the keyboard —
  // reading it reported a top edge of 132px, i.e. the status bar. The inset source is the
  // number the system actually hands to apps.
  const dump = adbTry('shell', 'dumpsys', 'window');
  const line = dump
    .split('\n')
    .find((l) => /InsetsSource id=\d+ type=ime /.test(l) && /visible=true/.test(l));
  if (!line) return null;
  const frame = /frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(line);
  // A zero-height inset is "no keyboard on screen", however loudly `mInputShown` says true —
  // an AVD with `hw.keyboard=yes` reports exactly that, and it made a screen look safe.
  return frame && Number(frame[4]) > Number(frame[2]) ? Number(frame[2]) : null;
}

/**
 * `adjust=pan` or `adjust=resize`. This app declares no `windowSoftInputMode`, and on an
 * edge-to-edge activity Android 15+ no longer resizes the window for the IME — so which one
 * is in force decides what "covered" can even mean.
 */
function imeAdjustMode() {
  const dump = adbTry('shell', 'dumpsys', 'window', 'windows');
  return /sim=\{adjust=(\w+)/.exec(dump.split('InputMethod}')[1] ?? '')?.[1] ?? '(unknown)';
}

async function go(conn, route) {
  await goto(conn, route);
  const landed = await until(conn, (p) => p.replace(/index\.html$/, '') === route.split('?')[0], 15);
  // Give the client fetch its turn; every screen here paints its shell first.
  await sleep(3500);
  return landed;
}

const READ_TEXT = `(document.body.innerText || '').trim().replace(/\\s+/g, ' ')`;

// ── item 2 ──────────────────────────────────────────────────────────────────────────────
// `trailingSlash` + the Capacitor local server's path resolution. The plan calls this the
// item that gates everything else, and it has two halves: a nested route with a query string
// must resolve to its OWN document, and an in-app link must move without loading one.
async function item2(conn) {
  const evidence = [];
  let ok = true;

  const home = await go(conn, '/driver/');
  const homeText = await evaluate(conn, READ_TEXT);
  evidence.push(`/driver/ → ${home} · ${homeText.length} chars`);

  const nested = '/driver/deliveries/detail/?id=probe-not-a-real-id';
  const landedNested = await go(conn, nested);
  const nestedText = await evaluate(conn, READ_TEXT);
  const sameDoc = nestedText === homeText;
  evidence.push(
    `${nested} → ${landedNested} · ${nestedText.length} chars · own document: ${!sameDoc}`,
  );
  if (sameDoc || !landedNested) ok = false;

  // Half two: a router push, which is what every real navigation in this app actually is.
  await go(conn, '/driver/');
  const pushed = await evaluate(
    conn,
    `(async () => {
      const before = location.pathname;
      const loads = performance.getEntriesByType('navigation').length;
      const link = [...document.querySelectorAll('a[href]')]
        .find((a) => new URL(a.href, location.href).pathname !== before);
      if (!link) return 'no in-app link on /driver/';
      link.click();
      await new Promise((r) => setTimeout(r, 2500));
      return JSON.stringify({
        before,
        after: location.pathname,
        documentLoads: performance.getEntriesByType('navigation').length,
        wasOne: loads,
      });
    })()`,
  );
  evidence.push(`router push: ${pushed}`);
  try {
    const p = JSON.parse(pushed);
    if (p.before === p.after || p.documentLoads !== p.wasOne) ok = false;
  } catch {
    ok = false;
  }

  record(2, 'trailingSlash + local-server path resolution', ok ? 'PASS' : 'FAIL', evidence);
}

// ── item 5 ──────────────────────────────────────────────────────────────────────────────
// Login → protected call → logout, all over bearer. Silent refresh is checked separately
// (it needs a short JWT_ACCESS_TTL on the stack), so this half proves the transport: an
// `Authorization` header on the protected call and NO cookie, which is the whole point of
// the native branch in `api.ts`.
async function item5(conn) {
  const evidence = [];
  const seen = [];
  const byId = new Map();
  await conn.send('Network.enable');
  const off = conn.on((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const { url, headers, method } = msg.params.request;
      if (!/\/api\/v1\//.test(url)) return;
      const row = { url, headers, method, status: null };
      byId.set(msg.params.requestId, row);
      seen.push(row);
    }
    if (msg.method === 'Network.responseReceived') {
      const row = byId.get(msg.params.requestId);
      if (row) row.status = msg.params.response.status;
    }
  });

  await go(conn, '/driver/');
  await sleep(2500);
  off();

  // OPTIONS is excluded on purpose, not for convenience: a CORS preflight is forbidden by
  // spec from carrying `Authorization`, so counting them made five of ten calls look
  // unauthenticated on the first run. The app is cross-origin here (`https://localhost` →
  // the gateway), so every protected GET is preceded by one.
  const protectedCalls = seen.filter(
    (r) => r.method !== 'OPTIONS' && !/\/auth\/(login|otp)/.test(r.url),
  );
  const withBearer = protectedCalls.filter((r) =>
    /^Bearer /.test(r.headers.Authorization ?? r.headers.authorization ?? ''),
  );
  const withCookie = protectedCalls.filter((r) => r.headers.Cookie ?? r.headers.cookie);
  evidence.push(`${protectedCalls.length} protected call(s) observed`);
  evidence.push(`  with Authorization: Bearer → ${withBearer.length}`);
  evidence.push(`  carrying a Cookie header → ${withCookie.length}`);
  for (const r of protectedCalls) {
    const bearer = /^Bearer /.test(r.headers.Authorization ?? r.headers.authorization ?? '');
    evidence.push(
      `  ${bearer ? 'bearer' : 'NO-AUTH'} ${r.method} ${String(r.status ?? '—').padStart(3)} ` +
        r.url.replace(/^https?:\/\//, ''),
    );
  }

  const ok = protectedCalls.length > 0 && withBearer.length === protectedCalls.length && !withCookie.length;
  record(5, 'protected calls travel by bearer, not cookie', ok ? 'PASS' : 'FAIL', evidence);
}

// ── item 8 ──────────────────────────────────────────────────────────────────────────────
// The hardware back button: closes an overlay, then walks history, then leaves the app.
// Driven with a real KEYCODE_BACK, because the thing under test is the Capacitor App
// plugin's event — dispatching it in JS would test nothing.
async function item8(conn) {
  const evidence = [];
  let ok = true;

  // 1. an overlay closes and the route does not move.
  //
  // The first-run tour, not a button hunt: it is `aria-modal="true"` by design (E10 in
  // `onboarding-tour.tsx`, put there so back would close it), it is the overlay every user
  // meets first, and it needs no session. Clicking arbitrary buttons to find a modal
  // navigated away and destroyed the execution context instead.
  // Read where the app already is. Navigating to `/` re-enters Capacitor's `appUrl`, which
  // destroys the WebView's CDP page target and takes the connection with it — the run then
  // ends on "unsettled top-level await" having printed nothing.
  const opened = await evaluate(
    conn,
    `document.querySelector('[aria-modal="true"]') ? 'first-run tour' : null`,
  );
  if (!opened) {
    evidence.push('no overlay reachable from /driver/ — overlay half not measured');
    ok = false;
  } else {
    const routeBefore = await evaluate(conn, 'location.pathname');
    adb('shell', 'input', 'keyevent', '4');
    await sleep(1200);
    const stillOpen = await evaluate(conn, '!!document.querySelector(\'[aria-modal="true"]\')');
    const routeAfter = await evaluate(conn, 'location.pathname');
    evidence.push(`overlay from "${opened}": open after BACK = ${stillOpen}, route ${routeBefore} → ${routeAfter}`);
    if (stillOpen || routeBefore !== routeAfter) ok = false;
  }

  // 2. history walks back
  await go(conn, '/login/');
  await evaluate(
    conn,
    `(() => { const a = [...document.querySelectorAll('a[href]')]
        .find((x) => new URL(x.href, location.href).pathname !== location.pathname);
      if (a) a.click(); return !!a; })()`,
  );
  await sleep(3000);
  const deep = await evaluate(conn, 'location.pathname');
  adb('shell', 'input', 'keyevent', '4');
  await sleep(2000);
  const back = await evaluate(conn, 'location.pathname');
  evidence.push(`history: ${deep} --BACK--> ${back}`);
  if (deep === back) ok = false;

  // 3. at the root with nothing behind it, BACK leaves the app rather than sitting there
  adb('shell', 'am', 'force-stop', appId);
  adb('shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1');
  await sleep(7000);
  const foreground = resumedActivity();
  adb('shell', 'input', 'keyevent', '4');
  await sleep(2500);
  const after = resumedActivity();
  evidence.push(`root: foreground ${foreground} --BACK--> ${after}`);
  if (after.includes(appId)) ok = false;

  record(8, 'hardware back: overlay, history, exit', ok ? 'PASS' : 'FAIL', evidence);
}

// ── item 10 ─────────────────────────────────────────────────────────────────────────────
// The Android soft keyboard must not sit on top of the bottom nav / the primary button.
// Measured, not eyeballed: focus the field, wait for `mInputShown=true`, then compare the
// visual viewport with the element's own rectangle.
async function item10(conn, routes) {
  const evidence = [];
  let ok = true;
  // Page y=0 is NOT screen y=0 here — see `viewportTop()`. Read once: it is the status bar,
  // and nothing on this screen moves it. Every screen-pixel number below goes through it, both
  // the tap target and the boxes compared against the keyboard's own frame.
  const top = viewportTop();
  evidence.push(`page y=0 sits at screen y=${top} (status bar); window.screenY claims 0`);
  for (const [route, selector, prepare] of routes) {
    // `/verify` only exists between "send me a code" and the code arriving — navigating
    // straight to it lands on `/login`, which is why the first run reported "no element"
    // rather than a measurement. Screens with a precondition get driven to, not jumped to.
    const landed = prepare ? await prepare(conn) : await go(conn, route);
    if (!landed) {
      evidence.push(`${route}: never landed — not measured`);
      ok = false;
      continue;
    }
    // A real tap, not `el.focus()`. Android raises the IME for a genuine touch on an
    // editable node; a scripted focus moves the caret and the keyboard never appears —
    // which is exactly what the first run measured, and it would have read as a pass.
    const where = await evaluate(
      conn,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'no-element';
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const d = window.devicePixelRatio;
        // What is actually ON TOP at the point about to be tapped. A tap that lands on a
        // sticky header, a toast or a transition wrapper focuses nothing, the IME never
        // opens, and the run reports "keyboard never came up" — which reads like a device
        // fact and is really a miss. Naming the element turns one into the other.
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return JSON.stringify({
          x: Math.round((r.left + r.width / 2) * d),
          y: Math.round((r.top + r.height / 2) * d) + ${top},
          onTop: hit === el ? 'the element itself'
            : hit ? hit.tagName.toLowerCase() + '.' + String(hit.className || '').slice(0, 40)
            : '(nothing)',
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        }); })()`,
    );
    if (where === 'no-element') {
      evidence.push(`${route}: ${selector} not found — not measured`);
      ok = false;
      continue;
    }
    const { x, y, onTop, rect } = JSON.parse(where);
    evidence.push(
      `${route}: tapping ${selector} at screen ${x},${y} · css rect [${rect}] · on top: ${onTop}`,
    );
    // Before, so "the keyboard did not cover anything" can be told apart from "the viewport
    // never changed and the test could not have failed". `adjustResize` shrinks the window;
    // if neither number moves, nothing was actually measured.
    const before = JSON.parse(
      await evaluate(
        conn,
        `JSON.stringify({ layout: window.innerHeight,
          visual: window.visualViewport ? Math.round(window.visualViewport.height) : null })`,
      ),
    );
    adb('shell', 'input', 'tap', String(x), String(y));
    await sleep(3000);
    const shown = keyboardShown();
    const geom = await evaluate(
      conn,
      `(() => {
        const vv = window.visualViewport;
        const nav = document.querySelector('nav[class*="fixed"], [data-bottom-nav], footer');
        const cta = [...document.querySelectorAll('button')].pop();
        const d = window.devicePixelRatio;
        // Screen pixels, so the answer can be compared with the keyboard's own frame.
        const box = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top * d) + ${top},
                   bottom: Math.round(r.bottom * d) + ${top} };
        };
        return JSON.stringify({
          innerHeight: window.innerHeight,
          visual: vv ? Math.round(vv.height) : null,
          dpr: d, screenY: window.screenY,
          nav: box(nav), cta: box(cta), focused: box(document.activeElement),
        });
      })()`,
    );
    const g = JSON.parse(geom);
    const keyboardTop = imeTop();
    // Covered = the element's bottom edge sits below the top of the keyboard, on screen.
    const overlaps = (b) => (b && keyboardTop !== null ? b.bottom > keyboardTop : null);
    evidence.push(
      `${route} · keyboard shown=${shown} (${imeAdjustMode()}), top edge at y=${keyboardTop}px of screen` +
        ` · layout ${before.layout}→${g.innerHeight}px · visual ${before.visual}→${g.visual}px`,
    );
    evidence.push(
      `  bottom nav ${g.nav ? `[${g.nav.top}..${g.nav.bottom}]` : '(none)'} covered=${overlaps(g.nav)}` +
        ` · last button ${g.cta ? `[${g.cta.top}..${g.cta.bottom}]` : '(none)'} covered=${overlaps(g.cta)}`,
    );
    evidence.push(
      `  focused field ${g.focused ? `[${g.focused.top}..${g.focused.bottom}]` : '(none)'}` +
        ` covered=${overlaps(g.focused)}`,
    );
    if (!shown || keyboardTop === null) {
      evidence.push(`  ${route}: keyboard never came up — not measured`);
      ok = false;
    } else if (overlaps(g.focused)) {
      // The field being typed into is the one thing that can never be under the keyboard.
      ok = false;
    } else if (overlaps(g.nav) || overlaps(g.cta)) {
      ok = false;
    }
    adb('shell', 'input', 'keyevent', '111'); // ESCAPE dismisses the IME
    await sleep(800);
  }
  record(10, 'soft keyboard does not cover the bottom nav / primary button', ok ? 'PASS' : 'FAIL', evidence);
}

// ── item 1 ──────────────────────────────────────────────────────────────────────────────
// The two camera paths, which are NOT the same mechanism and fail differently:
//   1a `getUserMedia` — HR face check-in, a live stream in a plain Capacitor WebView
//   1b `<input capture="environment">` — the PoD photo, an Android file/camera chooser
async function item1a(conn, route) {
  const evidence = [];
  const landed = await go(conn, route);
  evidence.push(`${route} → ${landed}`);
  const answer = await evaluate(
    conn,
    `(async () => {
      if (!navigator.mediaDevices?.getUserMedia) return 'no navigator.mediaDevices';
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        const t = s.getVideoTracks()[0];
        const out = { label: t.label, readyState: t.readyState, settings: t.getSettings() };
        s.getTracks().forEach((x) => x.stop());
        return JSON.stringify(out);
      } catch (e) { return 'threw: ' + e.name + ' — ' + e.message; }
    })()`,
  );
  evidence.push(`getUserMedia({facingMode:'user'}): ${answer}`);
  const granted = adbTry('shell', 'dumpsys', 'package', appId).includes('android.permission.CAMERA: granted=true');
  evidence.push(`OS camera permission granted to ${appId}: ${granted}`);
  record('1a', 'getUserMedia (HR face check-in) in a plain Capacitor WebView',
    answer.startsWith('{') ? 'PASS' : 'FAIL', evidence);
}

async function item1b(conn, route) {
  const evidence = [];
  const landed = await go(conn, route);
  evidence.push(`${route} → ${landed}`);
  const before = resumedActivity();
  const clicked = await evaluate(
    conn,
    `(() => {
      const el = document.querySelector('input[type="file"][capture]');
      if (!el) return 'no capture input on this screen';
      el.click();
      return 'clicked ' + el.getAttribute('accept') + ' capture=' + el.getAttribute('capture');
    })()`,
  );
  evidence.push(clicked);
  await sleep(3000);
  const after = resumedActivity();
  evidence.push(`foreground activity ${before} → ${after}`);
  // Capacitor answers a file input with `WebChromeClient.onShowFileChooser`; if the bridge
  // did not implement it the click is swallowed and nothing at all comes to the front.
  record('1b', 'PoD photo: <input capture> opens a native chooser',
    clicked.startsWith('clicked') && after !== before ? 'PASS' : 'FAIL', evidence);
}

// ── item 9 ──────────────────────────────────────────────────────────────────────────────
// The cashier's receipt. `printDocument` deliberately shares an HTML file rather than
// printing (Android has no print API a Capacitor core plugin exposes), so what is proven
// here is that the native share sheet actually comes up for it.
/**
 * In-app navigation, by pressing the link a person presses.
 *
 * `go()` loads the document, and a console route answers that with its role landing: asking
 * for `/dashboard/walk-in/` as a document put the probe on `/dashboard/` with no walk-in form
 * anywhere, which reads like a missing screen. Nothing in the app issues such a load — every
 * move inside the console is a router push — so the probe stops issuing them too.
 */
async function follow(conn, href, tries = 15) {
  for (let i = 0; i < tries; i++) {
    const hit = await evaluate(
      conn,
      `(() => {
        const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === ${JSON.stringify(href)});
        if (!a) return 'miss';
        a.click();
        return 'ok';
      })()`,
    );
    if (hit === 'ok') break;
    await sleep(1000);
  }
  const landed = await until(conn, (p) => p.startsWith(href.replace(/\/$/, '')), 15);
  await sleep(3500);
  return landed;
}

/** Press the first enabled button whose label matches, waiting for it to exist. */
async function press(conn, re, tries = 15) {
  for (let i = 0; i < tries; i++) {
    const hit = await evaluate(
      conn,
      `(() => {
        const b = [...document.querySelectorAll('button')]
          .find((x) => ${re}.test((x.innerText || x.getAttribute('aria-label') || '').trim()) && !x.disabled);
        if (!b) return 'miss';
        b.click();
        return 'ok';
      })()`,
    );
    if (hit === 'ok') return 'ok';
    await sleep(1500);
  }
  return 'never appeared';
}

async function item9(conn) {
  const evidence = [];
  const landed = await follow(conn, '/dashboard/walk-in/');
  evidence.push(`/dashboard/walk-in/ → ${landed}`);
  // A real sale, because the receipt is what is being tested and there is no receipt without
  // one. Needs an OPEN cashier shift; `CashierShiftBar` disables the submit button without it.
  evidence.push(`quantity +1: ${await press(conn, '/^Increase quantity$/i')}`);
  await evaluate(conn, TYPE('#wi-cash', '100000'));
  await sleep(1200);
  evidence.push(
    `total on screen: ${await evaluate(conn, `(document.body.innerText.match(/Total\\s+Rp\\s*[\\d.]+/) || ['(none)'])[0].replace(/\\s+/g, ' ')`)}`,
  );
  const before = resumedActivity();
  const clicked = await press(conn, '/cetak struk/i');
  evidence.push(`"Simpan & cetak struk": ${clicked}`);
  // The share sheet is a separate activity and it is not instant — the sale posts, the payment
  // confirms and only then is the file written and shared.
  let after = before;
  for (let i = 0; i < 12 && after === before; i++) {
    await sleep(1500);
    after = resumedActivity();
  }
  evidence.push(`foreground activity ${before} → ${after}`);
  record(9, 'walk-in receipt reaches the native share/print path',
    clicked === 'ok' && after !== before ? 'PASS' : 'FAIL', evidence);
}

// ── item 6 ──────────────────────────────────────────────────────────────────────────────
// The offline capture queue, on the surface it exists for: proof of delivery. The photo is
// built in the page and handed to the real file input through a `DataTransfer`, so no camera
// is needed; the network is cut with CDP rather than the radio, so only the WebView loses the
// link and adb keeps working.
async function item6(conn, deliveryId) {
  const evidence = [];
  const queued = () =>
    evaluate(
      conn,
      `new Promise((res) => {
        const req = indexedDB.open('hm.offline', 1);
        req.onerror = () => res('open failed');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('jobs')) { db.close(); return res('[]'); }
          const all = db.transaction('jobs', 'readonly').objectStore('jobs').getAll();
          all.onsuccess = () => { db.close(); res(JSON.stringify(all.result.map((j) => ({
            kind: j.kind, delivery: (j.payload?.deliveryId || '').slice(0, 8),
            photoChars: j.payload?.photo?.length, attempts: j.attempts ?? 0, error: j.error ?? null,
          })))); };
          all.onerror = () => { db.close(); res('read failed'); };
        };
      })`,
    );

  await goto(conn, `/driver/deliveries/detail/?id=${deliveryId}`);
  await until(conn, (p) => p.startsWith('/driver/deliveries/detail'), 15);
  await sleep(4000);
  evidence.push(`opened delivery ${deliveryId.slice(0, 8)} · ${await evaluate(conn, 'location.pathname')}`);
  evidence.push(`"Sampai tujuan": ${await press(conn, '/Sampai tujuan/i')}`);
  for (let i = 0; i < 10; i++) {
    if (await evaluate(conn, `!!document.querySelector('input[type="file"][capture]')`)) break;
    await sleep(1000);
  }
  const photo = await evaluate(
    conn,
    `(async () => {
      const input = document.querySelector('input[type="file"][capture]');
      if (!input) return 'no capture input on this screen';
      const c = document.createElement('canvas');
      c.width = 640; c.height = 480;
      const g = c.getContext('2d');
      g.fillStyle = '#0f766e'; g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#fff'; g.font = '32px sans-serif'; g.fillText('BUKTI ANTAR', 160, 250);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      // \`input.files\` is read-only; a DataTransfer is the only way to fill it from script.
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'pod.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return blob.size + ' byte JPEG';
    })()`,
  );
  evidence.push(`photo: ${photo}`);
  evidence.push(
    `seal: ${await evaluate(conn, `(() => { const c = document.querySelector('input[type="checkbox"]'); if (!c) return 'no checkbox'; c.click(); return c.checked; })()`)}`,
  );
  await evaluate(conn, TYPE('input[maxlength="120"]', 'Bu Sari'));

  await conn.send('Network.enable');
  await conn.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  evidence.push(`network cut · navigator.onLine=${await evaluate(conn, 'navigator.onLine')}`);
  evidence.push(`submit offline: ${await press(conn, '/Selesaikan|Selesai|Kirim|Simpan/i')}`);

  let offline = '[]';
  for (let i = 0; i < 20 && offline === '[]'; i++) {
    await sleep(2000);
    offline = await queued();
  }
  evidence.push(`IndexedDB hm.offline/jobs while offline: ${offline}`);

  await conn.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  // The app flushes on `online` and on app resume; `online` is the event a returning signal
  // fires, so that is the one used here. Its first attempt sets a 30s backoff if it fails, and
  // `flushNow` (the "Kirim sekarang" button) is what ignores that — which is why both run.
  await evaluate(conn, `window.dispatchEvent(new Event('online'))`);
  let drained = offline;
  for (let i = 0; i < 12 && drained !== '[]'; i++) {
    await sleep(2500);
    if (i === 4) await press(conn, '/Kirim sekarang/i', 1);
    drained = await queued();
  }
  evidence.push(`after reconnect: ${drained}`);
  record(6, 'proof of delivery survives being captured offline and flushes on reconnect',
    offline.startsWith('[{') && drained === '[]' ? 'PASS' : 'FAIL', evidence);
}

// ────────────────────────────────────────────────────────────────────────────────────────
const want = (id) => !only.length || only.includes(String(id));

adb('shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(8000);

const conn = cdp(await devtoolsUrl(appId));
await conn.ready;
await conn.send('Runtime.enable');
// Item 8 needs the first-run tour still standing — it is the overlay the back button is
// measured against — so the one run that asks only for item 8 does not dismiss it.
if (!(only.length === 1 && only[0] === '8')) await skipOnboarding(conn);

if (loginPhone) {
  const failed = await login(conn, loginPhone, loginOtp);
  console.log(`login ${loginPhone}: ${failed ?? 'ok'}`);
  if (failed) {
    console.log('cannot continue signed out');
    process.exit(1);
  }
}

if (want('1a')) await item1a(conn, flag('--face-route') ?? '/hr/me/check-in/');
if (want('1b')) await item1b(conn, flag('--pod-route') ?? '/driver/');
if (want(2)) await item2(conn);
if (want(5)) await item5(conn);
if (want(6)) await item6(conn, flag('--delivery') ?? '7c0050d5-5bd3-4b9a-962f-f70b0847f5ec');
if (want(9)) await item9(conn);
if (want(10)) {
  /**
   * `/verify` is the screen the plan names, and it is the one screen here that cannot be
   * jumped to: it exists only between "send me a code" and the code arriving, and asking
   * for a code costs an OTP that `POST /auth/login` rate-limits to one per phone per
   * minute. So it is driven to, once, and only when asked for — `--verify`. `/login`
   * carries the same layout (one field, one fixed CTA under it) at no such cost.
   */
  const toVerify = async (c) => {
    await go(c, '/login/');
    await evaluate(c, TYPE('#phone', loginPhone ?? '81100000003'));
    await evaluate(c, `document.querySelector('#phone').closest('form').requestSubmit()`);
    const landed = await until(c, (p) => p.startsWith('/verify'), 20);
    await sleep(2500);
    // A signed-in session, or a rate-limited request, bounces straight back — and measuring
    // `/login` while believing it is `/verify` is worse than not measuring at all.
    return (await evaluate(c, 'location.pathname')).startsWith('/verify') ? landed : null;
  };
  /**
   * `/checkout` is the other screen the plan names, and it has no text field at all in the
   * state a returning customer arrives in: the address form is HIDDEN while a saved address
   * is selected, and one is selected for them automatically. So the probe reported "no
   * element" and measured nothing — which reads like a missing screen and is really a
   * customer with an address book. `+ Alamat baru` is what a person taps to type one — and
   * it is two taps down, because the screen is a stepper whose sections start collapsed.
   */
  const toCheckout = async (c) => {
    const landed = await go(c, '/checkout/');
    console.log(`  /checkout/ landed=${landed}`);
    if (!landed) return null;
    // Polled, not asked once: this screen waits on the cart, the address book and a price
    // quote before it draws anything, and a single look lands on the skeleton.
    const tap = async (label) => {
      for (let i = 0; i < 12; i++) {
        const hit = await evaluate(
          c,
          `(() => {
            const b = [...document.querySelectorAll('button')].find((x) => ${label}.test((x.textContent || '').trim()));
            if (!b) return 'miss';
            b.click();
            return 'ok';
          })()`,
        );
        if (hit === 'ok') return 'ok';
        await sleep(1500);
      }
      return 'miss';
    };
    // The section, then the control inside it. Both are buttons; only the second one exists
    // before the first has been pressed.
    const section = await tap('/^Alamat pengiriman/i');
    await sleep(1200);
    const opened = section === 'ok' ? await tap('/Alamat baru/i') : 'section never opened';
    console.log(`  /checkout/ address section: ${section} · new-address button: ${opened}`);
    await sleep(1500);
    return opened === 'ok' ? landed : null;
  };

  const routes = [['/login/', '#phone']];
  if (flag('--verify')) routes.push(['/verify/', 'input[inputmode="numeric"]', toVerify]);
  if (flag('--checkout')) routes.push(['/checkout/', '#recipientName', toCheckout]);
  for (const r of argv.slice(1)) routes.push([r, 'input:not([type=hidden]), textarea']);
  await item10(conn, routes);
}
// Back is last: its third check force-stops the app, which ends the CDP session.
if (want(8)) await item8(conn);

console.log('\n──────── summary ────────');
for (const r of results) console.log(`  ${String(r.id).padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}`);
process.exit(results.some((r) => r.verdict !== 'PASS') ? 1 : 0);
