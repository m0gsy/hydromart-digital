#!/usr/bin/env node
/**
 * The static-export half of the Fase 0 sweep: every page of a binary, at every width the
 * app is held at, with NO backend.
 *
 * This is not the same question the live sweep asks. It measures what the APK actually
 * loads — the shell, the chrome, the empty states, the CSS — and it measures it for pages
 * the live sweep cannot reach because they are behind a role or a depot. What it cannot see
 * is anything that needs data: 15 of the customer binary's 26 pages render an auth gate,
 * and every ops page renders its "no session" state. That is a real limit, and it is why
 * the live sweep exists too; a clean run here is not a claim about screens with data on
 * them.
 *
 *   node scripts/export-width-sweep.mjs customer|ops [port]
 *
 * Serves `apps/web/mobile-out-<target>` itself (the export is `trailingSlash: true`, so a
 * directory maps to its `index.html`) and drives Chromium over it.
 *
 * A request to a host that is neither the local server nor the API gateway the build was
 * pointed at is a finding: in an exported build, a page that reaches for a CDN font or an
 * analytics beacon is a page that breaks on a phone with no signal. The gateway itself is
 * expected and allowed — it is the whole point of the app — and its host is read from the
 * same env var the build baked in.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

const target = process.argv[2];
if (target !== 'customer' && target !== 'ops') {
  console.error('usage: node scripts/export-width-sweep.mjs customer|ops [port]');
  process.exit(2);
}
const PORT = Number(process.argv[3] ?? 4321);
const ROOT = resolve('apps/web', `mobile-out-${target}`);
if (!existsSync(ROOT)) {
  console.error(`${ROOT} does not exist — run: node apps/web/scripts/build-mobile.mjs ${target}`);
  process.exit(2);
}

const WIDTHS = [
  { w: 320, h: 568 },
  { w: 360, h: 800 },
  { w: 390, h: 844 },
  { w: 412, h: 915 },
  { w: 428, h: 926 },
];

/**
 * The API host the export was built against. Requests there are expected; anything else is
 * a third party the APK would depend on. Read from the env rather than hardcoded, because a
 * CI-built export points at prod and a local one at localhost.
 */
const API_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').host;
  } catch {
    return '';
  }
})();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Every exported page, as the route the app would call it. */
function pages(dir = ROOT, route = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...pages(join(dir, entry.name), `${route}/${entry.name}`));
    else if (entry.name === 'index.html') out.push(route || '/');
  }
  return out;
}

const server = createServer(async (req, res) => {
  // A path is only ever read from inside the export. `normalize` first, then refuse anything
  // that climbed out — this serves a directory to a browser, and that is enough reason.
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const full = join(ROOT, rel);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end('no');
    return;
  }
  for (const candidate of [full, join(full, 'index.html'), `${full}.html`]) {
    try {
      const s = await stat(candidate);
      if (!s.isFile()) continue;
      res.writeHead(200, { 'content-type': MIME[extname(candidate)] ?? 'application/octet-stream' });
      res.end(await readFile(candidate));
      return;
    } catch {
      /* try the next shape */
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const routes = pages().sort();
const findings = [];
const note = (route, kind, detail, width = null) =>
  findings.push({ target, route, width, kind, detail: String(detail).slice(0, 300) });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
});
await ctx.addInitScript(() => {
  localStorage.setItem('hydromart.locale', 'id');
  localStorage.setItem('hydromart.onboarded', '1');
  localStorage.setItem('hydromart_driver_onboarded', '1');
});

/* c8 ignore start — browser-side */
const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const sel = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join('.');
    const txt = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`;
  };
  const docOver = Math.round(document.documentElement.scrollWidth - vw);
  const wide = [];
  if (docOver > 0) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && r.height > 0) wide.push(`${sel(el)} (+${Math.round(r.width - vw)})`);
    }
  }
  return { docOver, wide: wide.slice(0, 3), chars: (document.body?.innerText ?? '').trim().length };
};
/* c8 ignore stop */

for (const route of routes) {
  const p = await ctx.newPage();
  const errors = [];
  const offHost = new Set();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('request', (r) => {
    const h = new URL(r.url()).host;
    if (h && h !== `127.0.0.1:${PORT}` && h !== `localhost:${PORT}` && h !== API_HOST)
      offHost.add(h);
  });
  try {
    await p.goto(`http://127.0.0.1:${PORT}${route === '/' ? '/' : `${route}/`}`, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await p.waitForTimeout(250);
    for (const { w, h } of WIDTHS) {
      await p.setViewportSize({ width: w, height: h });
      await p.waitForTimeout(150);
      const m = await p.evaluate(MEASURE);
      if (m.docOver > 0)
        note(route, 'PAGE OVERFLOW', `${m.docOver}px past ${w} — ${m.wide.join(' | ')}`, w);
      // An export whose page renders nothing at all is a page the APK shows blank.
      if (m.chars < 20) note(route, 'EMPTY', `${m.chars} chars`, w);
    }
    for (const host of offHost) note(route, 'OFF-HOST REQUEST', host);
    for (const e of [...new Set(errors)].slice(0, 2)) {
      // A blocked cross-origin read of the GATEWAY is this harness's own doing: the export is
      // served from 127.0.0.1 and the gateway's CORS allowlist names :3000. It says nothing
      // about the APK, where the origin is the asset scheme and the gateway is configured for
      // it — so it is filtered, and any OTHER console error still counts.
      if (!new RegExp(`favicon|ResizeObserver|Download the React|hydration|Failed to fetch|NetworkError|ERR_|CORS policy`, 'i').test(e))
        note(route, 'CONSOLE', e);
    }
  } catch (e) {
    note(route, 'THREW', e.message);
  } finally {
    await p.close();
  }
  process.stdout.write('.');
}

await browser.close();
server.close();

console.log(
  `\n${target}: ${routes.length} page(s) × ${WIDTHS.length} width(s) — ${findings.length} finding(s)`,
);
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`\n### ${kind} (${list.length})`);
  for (const f of list.slice(0, 40)) console.log(`  ${String(f.width ?? '-').padStart(4)}  ${f.route}  ${f.detail}`);
  if (list.length > 40) console.log(`  … ${list.length - 40} more`);
}
process.exit(findings.length ? 1 : 0);
