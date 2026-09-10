// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { WEBVIEW_GATE_SCRIPT, WEBVIEW_MIN_CHROME } from '@/lib/webview-gate';

/**
 * J4 — the WebView-too-old screen, and the reason it is markup rather than a component.
 *
 * MEASURED 2026-09-10 on Android 9 / WebView 69.0.3497.100, debug APK on an emulator: the
 * React gate in `NativeBridge` never fired, because the bundle it lives in dies first on
 * `ReferenceError: globalThis is not defined` (Chrome 71+). React never mounts, so the one
 * screen whose whole job is to appear when the app is broken was itself part of the broken
 * app. What the person saw instead was the exported static HTML with 29 of a 75 kB
 * stylesheet's rules surviving — a Chrome-69 parser cannot open an `@layer` block.
 *
 * These tests run the script the way the document does: as text, in a fresh DOM, with a
 * user agent set per case.
 */
const CHROME_69_WV =
  'Mozilla/5.0 (Linux; Android 9; Android SDK built for x86_64 Build/PSR1.180720.122; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/69.0.3497.100 Mobile Safari/537.36';
const CHROME_133_WV =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Version/4.0 Chrome/133.0.6943.49 Mobile Safari/537.36';
const CHROME_69_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/69.0.3497.100 Safari/537.36';

function runWith(ua: string): string {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  document.body.innerHTML = '<main id="app">Air minum, diantar ke rumah.</main>';
  // eslint-disable-next-line no-new-func -- the point of the test is to execute the string
  // the document executes, not a re-typed copy of it that could drift.
  new Function(WEBVIEW_GATE_SCRIPT)();
  return document.body.innerText || document.body.textContent || '';
}

describe('J4 the WebView gate runs without the bundle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
  });

  it('blocks the WebView that measurement caught the React gate missing', () => {
    const text = runWith(CHROME_69_WV);
    expect(text).toContain('Perbarui Android System WebView');
    // …and the page it replaced is gone, not merely covered.
    expect(text).not.toContain('Air minum');
    const link = document.querySelector('a');
    expect(link?.getAttribute('href')).toBe('market://details?id=com.google.android.webview');
  });

  it('leaves a WebView new enough for Tailwind v4 alone', () => {
    expect(runWith(CHROME_133_WV)).toContain('Air minum');
    expect(document.querySelector('a')).toBeNull();
  });

  /*
   * Never on the open web. A desktop browser this old is somebody's problem and not this
   * app's, and locking a web visitor out on a user-agent guess is a worse failure than the
   * one it would prevent. `; wv)` is the token Android puts in a WebView UA and nowhere else.
   */
  it('never fires outside a WebView, however old the browser', () => {
    expect(runWith(CHROME_69_DESKTOP)).toContain('Air minum');
  });

  it('does not lock anybody out on a user agent it cannot read', () => {
    expect(runWith('Mozilla/5.0 (Linux; Android 9; wv) AppleWebKit/537.36')).toContain('Air minum');
  });

  /*
   * ES5 only, and this is not style policing: a syntax error in an inline `<head>` script is
   * a blank screen on every device, and the one engine it must run on is the one that
   * rejects modern syntax. `globalThis` is named explicitly because it is the exact token
   * that killed the bundle on WebView 69.
   */
  it('is written in syntax the engine it exists for can parse', () => {
    expect(WEBVIEW_GATE_SCRIPT).not.toMatch(/=>|`|\?\.|\?\?|\blet\b|\bconst\b|globalThis/);
    expect(WEBVIEW_MIN_CHROME).toBe(111);
    // The floor is compiled INTO the string, not read from a variable at runtime.
    expect(WEBVIEW_GATE_SCRIPT).toContain('>=111');
  });
});
