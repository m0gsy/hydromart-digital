/**
 * F3b: turn whatever arrives from outside the app into a route this build actually has.
 *
 * Two things call this, and they hand over two different shapes. An Android App Link is
 * an absolute `https://<web domain>/...` URL, because Android verified that domain
 * against `assetlinks.json` and handed us the browser's intent. A tapped notification is
 * the relative path crm-service put in the FCM `data` block.
 *
 * The rewriting is the part that is easy to forget. F1 replaced every dynamic segment
 * with a query parameter so the app could be exported as plain files — `/orders/[id]`
 * became `/orders/detail?id=`, and in an exported build the old shape is not a route with
 * stale data, it is a file that does not exist and therefore a blank screen. Links in the
 * old shape are still in the world: notifications already delivered to phones, WhatsApp
 * messages, bookmarks, anything sent before the change. They have to keep working, and
 * this is the only place that can make them.
 *
 * Pure and synchronous: the whole thing is exercised in `test/deep-link.test.ts` rather
 * than on a phone, which is what stops the next route rename from being found in
 * production.
 */

/**
 * Route prefixes whose next segment used to be an id. `/orders/abc` becomes
 * `/orders/detail?id=abc`, and `/orders/abc/review` becomes
 * `/orders/detail/review?id=abc` — the sub-page keeps its name, it just moves behind
 * `detail`, which is exactly what F1 did to the files.
 *
 * Longest first: `/dashboard/approvals` has to be tested before anything shorter could
 * shadow it, and keeping the list in that order means adding an entry cannot quietly
 * change how an existing one matches.
 */
const DYNAMIC_PARENTS = [
  '/dashboard/purchase-orders',
  '/dashboard/promotions',
  '/dashboard/approvals',
  '/dashboard/customers',
  '/m/manager/approvals',
  '/driver/deliveries',
  '/hr/employees',
  '/hr/payroll',
  '/products',
  '/orders',
];

/** Segments that are pages in their own right, not ids, under a dynamic parent. */
const NOT_AN_ID = new Set(['detail', 'new', 'import', 'settings']);

/**
 * Routes this binary does not carry, written by `scripts/build-mobile.mjs` from the very
 * list it prunes with — so the two cannot disagree. Empty everywhere else, which is the
 * right answer for the web build: it serves all 226 routes.
 *
 * `/hq/*` is a subtree; `/hr` with no star is that route alone, because the Ops binary
 * drops the HR console index while keeping everything under `/hr/me`.
 */
const PRUNED = (process.env.NEXT_PUBLIC_MOBILE_PRUNED ?? '').split(',').filter(Boolean);

/**
 * Does THIS binary serve `path`? Exported because in-app navigation needs the same answer a
 * deep link does: the Ops binary drops the whole `/hq` subtree, and every console screen used
 * to send an expired session to `/hq/login` — a route that is not in that bundle. Sign-out and
 * session expiry both landed on nothing, with no way back in. The prune list comes from the
 * build itself (`NEXT_PUBLIC_MOBILE_PRUNED`), so this cannot drift from what was pruned.
 */
export function isServedHere(path: string): boolean {
  return servedHere(path, PRUNED);
}

function servedHere(path: string, pruned: string[]): boolean {
  return !pruned.some((entry) =>
    entry.endsWith('/*')
      ? path === entry.slice(0, -2) || path.startsWith(entry.slice(0, -1))
      : path === entry,
  );
}

/**
 * The path a deep link should open, or null when there is nothing sensible to open.
 *
 * Returns a path, never a URL: the caller hands it to the Next router, and a link that
 * could name another origin would let anything that can send this app an intent decide
 * what the WebView loads.
 *
 * A route this binary pruned resolves to home instead. The customer app has no
 * `/driver/...` file to serve, and pushing at one produces a blank screen with no
 * navigation left on it — a worse outcome than starting the person somewhere real.
 * Every source of these is outside our control: a phone with both apps installed, a
 * notification sent before a release, a link pasted into WhatsApp.
 */
export function resolveDeepLink(raw: string, pruned: string[] = PRUNED): string | null {
  const target = pathAndQuery(raw);
  if (target === null) return null;

  const [path, query] = splitQuery(target);
  // Checked before the rewrite rather than after, and identical either way: turning a
  // segment into `?id=` never moves a route out of the folder it was pruned with.
  if (!servedHere(path, pruned)) return '/';
  const unchanged = query ? `${path}?${query}` : path;
  const parent = DYNAMIC_PARENTS.find((p) => path.startsWith(`${p}/`));
  if (!parent) return unchanged;

  const rest = path.slice(parent.length + 1).split('/');
  const id = rest[0];
  if (!id || NOT_AN_ID.has(id)) return unchanged;

  const child = rest.slice(1).join('/');
  const suffix = child ? `/${child}` : '';
  const extra = query ? `&${query}` : '';
  return `${parent}/detail${suffix}?id=${encodeURIComponent(safeDecode(id))}${extra}`;
}

/** A path segment is already percent-encoded; normalise it without trusting it to be valid. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Reduce anything to the part of it that names a page here. An absolute URL keeps only
 * its path and query — the host has already done its job by the time Android delivers
 * the intent, and honouring it would mean navigating the app's own WebView to somebody
 * else's site. A protocol-relative `//evil.example/x` is the same trick spelled shorter,
 * and is why the check is on the second character too.
 */
function pathAndQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return trimmed.startsWith('//') ? null : trimmed;
  try {
    const url = new URL(trimmed);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function splitQuery(target: string): [string, string] {
  const at = target.indexOf('?');
  if (at === -1) return [stripTrailingSlash(target), ''];
  return [stripTrailingSlash(target.slice(0, at)), target.slice(at + 1)];
}

/**
 * `trailingSlash: true` means the exported files live at `orders/detail/index.html`, and
 * both `/orders/abc` and `/orders/abc/` reach this. The id must not come out as `abc/`.
 */
function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
