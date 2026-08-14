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

const appId = process.argv[2];
if (!appId) {
  console.error('usage: node scripts/apk-width-probe.mjs <appId> [route ...]');
  process.exit(2);
}
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ['/', '/products/'];

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();

/** Widths the app is held at, in dp. Density is pinned to 160 so px === dp. */
const WIDTHS = [320, 360, 390, 412, 428];

async function devtoolsUrl() {
  const pid = adb('shell', 'pidof', appId);
  if (!pid) throw new Error(`${appId} is not running`);
  adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 20; i++) {
    try {
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      // Plain HTTP on purpose and unavoidable: this is the Chrome DevTools socket that `adb
      // forward` exposes on loopback. It serves HTTP only, it is reachable from this machine
      // alone, and it carries no credential — the alternative is not measuring inside the APK.
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
    width: document.documentElement.clientWidth,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    chars: (document.body.innerText || '').trim().length,
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
try {
  // px === dp, so a 320 here is the 320 the CSS sees.
  adb('shell', 'wm', 'density', '160');
  for (const width of WIDTHS) {
    adb('shell', 'wm', 'size', `${width}x800`);
    await sleep(2500);
    const conn = cdp(await devtoolsUrl());
    await conn.ready;
    await conn.send('Runtime.enable');
    for (const route of routes) {
      // The APK loads from a file/asset origin, so a route is a path under it; navigating by
      // `location.assign` keeps whatever origin the WebView already has.
      await conn.send('Runtime.evaluate', {
        expression: `location.assign(${JSON.stringify(route)})`,
      });
      // `location.assign` destroys the execution context, so the read has to wait for the new
      // one AND be prepared to find it not ready: the first attempt after a navigation
      // routinely comes back `undefined` rather than throwing.
      let v = null;
      for (let attempt = 0; attempt < 6 && !v; attempt++) {
        await sleep(1500);
        const res = await conn.send('Runtime.evaluate', { expression: READ, returnByValue: true });
        if (typeof res.result?.value === 'string') v = JSON.parse(res.result.value);
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
