'use client';

/**
 * The three things this app does that a browser handles for free and an Android
 * WebView does not. Each is one function so that when the Capacitor shell lands there
 * is exactly one place per capability to change — rather than nine `target="_blank"`
 * attributes, four object-URL downloads, and a `window.open` in the receipt printer,
 * all failing silently on a courier's phone.
 *
 * Every one of them answers `false` on the web today, meaning "I did nothing, let the
 * browser do what it already does". So this file changes no behaviour at all yet; it
 * only decides where the change will go.
 */

/**
 * A Capacitor WebView serves the app from `https://localhost` (or `capacitor://localhost`
 * on iOS) — the same origin check the gateway uses to decide bearer-vs-cookie, so the two
 * halves cannot drift apart. Deliberately not a `X-Client: native`-style flag: anything a
 * page can set, an XSS payload can set too.
 */
const NATIVE_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);

export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && NATIVE_ORIGINS.has(window.location.origin);
}

/**
 * Open something outside the app: a map, a phone dialler, WhatsApp, a receipt image.
 * Returns true when it took responsibility for the URL, so the caller can suppress the
 * browser's own default.
 *
 * On the web that is never — `<a target="_blank">` and `tel:` already work, and
 * intercepting them would only add a popup blocker to the path. In the WebView both
 * fail: `_blank` either does nothing or navigates the app's own view away with no way
 * back, and `tel:`/`https://wa.me` are unhandled schemes.
 */
export function openExternal(_url: string): boolean {
  // ponytail: the native branch is F3's, once @capacitor/browser + App are installed.
  return false;
}

/**
 * Save a file the user chose to download. Returns true when it handled it.
 *
 * An object URL plus a synthetic click is the only way to do this in a browser; in the
 * WebView there is no download manager listening, so the click lands on nothing and the
 * user gets no file and no error. F3 writes it through Filesystem + Share instead.
 */
export function saveFile(_filename: string, _blob: Blob): boolean {
  return false;
}

/**
 * Print (or share as a PDF) a receipt already rendered to an HTML document.
 * Returns true when it handled it.
 *
 * `window.open` + `window.print()` are both unsupported in an Android WebView, which is
 * why `printReceipt` returns a boolean its callers already act on.
 */
export function printDocument(_html: string): boolean {
  return false;
}
