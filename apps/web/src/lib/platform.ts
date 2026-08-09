'use client';

import { askPlugin, callPlugin } from './capacitor';

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
export function openExternal(url: string): boolean {
  if (!isNativeShell()) return false;
  // A Custom Tab for web pages — it keeps the app in the back stack, which a plain
  // navigation does not. Everything else (`tel:`, `mailto:`, `geo:`, and the `intent:`
  // shapes) is handed to the WebView, whose Capacitor client turns an unhandled scheme
  // into an Android Intent. Sending those to the browser plugin instead just fails.
  if (/^https?:/i.test(url)) return callPlugin('Browser', 'open', { url });
  window.location.assign(url);
  return true;
}

/**
 * Save a file the user chose to download. Returns true when it handled it.
 *
 * An object URL plus a synthetic click is the only way to do this in a browser; in the
 * WebView there is no download manager listening, so the click lands on nothing and the
 * user gets no file and no error. F3 writes it through Filesystem + Share instead.
 */
export function saveFile(filename: string, blob: Blob): boolean {
  if (!isNativeShell()) return false;
  // Returns immediately: the write and the share sheet are asynchronous, and the callers
  // (`downloadBlob`) are synchronous by design because that is what a browser download
  // is. "True" means the native path has taken it, not that the file is on disk yet.
  void writeAndShare(filename, blob);
  return true;
}

/**
 * Write to the app's cache directory, then offer the share sheet — the closest thing
 * Android has to a download. The cache directory rather than Documents so the OS can
 * reclaim the space: these are exports the user is about to send somewhere, not a
 * library the app is responsible for keeping.
 */
async function writeAndShare(filename: string, blob: Blob): Promise<void> {
  const data = await toBase64(blob);
  if (data === null) return;
  const written = await askPlugin<{ uri?: string }>('Filesystem', 'writeFile', {
    path: filename,
    data,
    directory: 'CACHE',
    recursive: true,
  });
  if (!written?.uri) return;
  callPlugin('Share', 'share', { title: filename, files: [written.uri] });
}

/** Filesystem.writeFile takes base64 for anything that is not plain text. */
function toBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    // `result` is a data URL — everything after the comma is the payload.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Print (or share as a PDF) a receipt already rendered to an HTML document.
 * Returns true when it handled it.
 *
 * `window.open` + `window.print()` are both unsupported in an Android WebView, which is
 * why `printReceipt` returns a boolean its callers already act on.
 */
export function printDocument(html: string): boolean {
  // ponytail: shares the receipt as an HTML file rather than printing it. Android has no
  // print API a Capacitor core plugin exposes, and the share sheet reaches every printer
  // app, Drive and WhatsApp — which is what a depot cashier actually does with a struk.
  // If a counter ever gets a real thermal printer, that is a Bluetooth plugin and a new
  // branch here, not a change to any caller.
  return saveFile('struk.html', new Blob([html], { type: 'text/html' }));
}
