#!/usr/bin/env node
/**
 * Does this build hydrate cleanly inside the APK, and if not, on which node?
 *
 *   node scripts/apk-hydration-probe.mjs id.hydromart.app
 *   node scripts/apk-hydration-probe.mjs id.hydromart.app --routes /,/products/ --snapshots out/
 *
 * A hydration mismatch is invisible in a release build — the app self-corrects by throwing
 * the server tree away and re-rendering the whole root on the client, which costs a frame,
 * every piece of state above the mismatch, and (measured) the Capacitor plugin's
 * `--safe-area-inset-*` values off `<html>`. Nothing reports it but a minified `#418` in a
 * console no user can open. This makes it a number.
 *
 * The probe itself is `lib/hydration-probe.js`, injected per document over CDP rather than
 * baked into the export: a change costs a reconnect instead of a seven-minute APK rebuild,
 * and the bundle under test stays the one that ships.
 *
 * Exits non-zero when a route hydrates dirty — or when the probe failed to install, which
 * otherwise reads exactly like a clean run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { adb, adbTry, cdp, devtoolsUrl, evaluate, goto, skipOnboarding, until } from './lib/apk-cdp.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const value = argv[i + 1] ?? fallback;
  argv.splice(i, 2);
  return value;
};
const snapshotDir = flag('--snapshots');
const routes = (flag('--routes') ?? '/,/products/,/orders/,/cart/,/account/,/promo/,/help/,/login/')
  .split(',')
  .filter(Boolean);
const appId = argv[0];
if (!appId) {
  console.error('usage: node scripts/apk-hydration-probe.mjs <appId> [--routes …] [--snapshots dir]');
  process.exit(2);
}

const PROBE = readFileSync(new URL('./lib/hydration-probe.js', import.meta.url), 'utf8');

// From scratch, so the first route measured is the launch document — the only one a user
// ever loads, and therefore the only one whose result is about the product.
adbTry('shell', 'am', 'force-stop', appId);
adb('shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(6_000);

const conn = cdp(await devtoolsUrl(appId));
await conn.ready;
await conn.send('Runtime.enable');
await conn.send('Page.enable');
await conn.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
await skipOnboarding(conn);
// The launch document was loaded before this connection existed, so it has no probe on it.
// Reloading `appUrl` is what puts one there without changing which document it is.
await conn.send('Page.reload');
await sleep(5_000);

let dirty = 0;
let missing = 0;

for (const [i, route] of routes.entries()) {
  if (i > 0) {
    await goto(conn, route);
    await until(conn, (p) => p === route || p.startsWith(route), 15);
    await sleep(3_000);
  }
  const raw = await evaluate(
    conn,
    `(() => { try {
      var L = window.__HYDRATION_PROBE_FLUSH && window.__HYDRATION_PROBE_FLUSH();
      if (!L) return JSON.stringify({ missing: true, p: location.pathname });
      return JSON.stringify({ p: location.pathname, err: L.err, mut: L.mut, snap: L.snap });
    } catch (e) { return JSON.stringify({ missing: true, p: 'threw ' + e.message }); } })()`,
  );
  let L;
  try {
    L = JSON.parse(raw ?? '{}');
  } catch {
    console.log(`${route.padEnd(18)} unreadable dump`);
    missing++;
    continue;
  }
  if (L.missing) {
    console.log(`${route.padEnd(18)} PROBE NOT INSTALLED (${L.p}) — this run measured nothing`);
    missing++;
    continue;
  }

  const errs = L.err ?? [];
  console.log(`${route.padEnd(18)} pathname=${String(L.p).padEnd(24)} ${errs.length ? `${errs.length} ERROR(S)` : 'clean'}`);
  if (!errs.length) continue;
  dirty++;

  errs.forEach((e, n) => {
    console.log(`    [${n}] t=${e.t}ms  ${e.msg.trim().slice(0, 150)}`);
    // The repairs React had already made when it complained. The first one is the node.
    for (const m of (L.mut ?? []).slice(Math.max(0, e.at - 6), e.at)) {
      console.log(`        ${m.k} ${m.p}\n          from ${JSON.stringify(m.from)}\n          to   ${JSON.stringify(m.to)}`);
    }
  });
  if (snapshotDir && L.snap) {
    const file = `${snapshotDir}/hydration${route.replace(/\W+/g, '_')}.html`;
    writeFileSync(file, L.snap);
    console.log(`    document as it stood at the first error -> ${file}`);
  }
}

conn.close();
console.log(`\n${routes.length - dirty - missing}/${routes.length} routes hydrate clean`);
process.exit(dirty || missing ? 1 : 0);
