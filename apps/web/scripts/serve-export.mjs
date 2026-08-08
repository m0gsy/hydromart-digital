#!/usr/bin/env node
/**
 * Serves `mobile-out/` the way Capacitor's WebViewLocalServer serves the assets bundled
 * into the APK, so a Playwright run against this answers a question about the binary and
 * not about whatever `npx serve` happens to do.
 *
 * The rule that matters is J2. Capacitor resolves a path with no file extension by
 * looking for `<path>/index.html` — it does NOT fall back to `<path>.html`. Without
 * `trailingSlash: true` the export writes `products.html`, this returns 404, and the
 * user gets a white screen on every hard load and every deep link. That failure is
 * silent in `next build`, so this is what makes it loud.
 *
 * Usage: node scripts/serve-export.mjs [dir] [port]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'mobile-out');
const PORT = Number(process.argv[3] ?? 4180);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function fileFor(urlPath) {
  // Reject traversal before touching the disk: `..` in a URL must never escape ROOT.
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '');
  const target = resolve(ROOT, clean);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;

  if (extname(target)) {
    return (await stat(target).catch(() => null))?.isFile() ? target : null;
  }
  const index = join(target, 'index.html');
  return (await stat(index).catch(() => null))?.isFile() ? index : null;
}

createServer(async (req, res) => {
  const file = await fileFor(req.url ?? '/');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`);
});
