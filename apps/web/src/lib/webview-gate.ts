/**
 * J4, net 2 of 2 — the WebView-too-old screen, written so it can run when the bundle cannot.
 *
 * `NativeBridge` already refuses to serve a WebView below Chrome 111, because Tailwind v4
 * compiles to `@property`, `color-mix()` and cascade layers and none of them exist before
 * it. Its own comment says the check "cannot be added later — an app already installed with
 * a broken layout has no screen left to tell the user anything on."
 *
 * MEASURED 2026-09-10, on Android 9 / WebView 69.0.3497.100, with the debug APK installed on
 * an emulator: the check never fired, and the sentence above came true instead. The bundle
 * dies on `ReferenceError: globalThis is not defined` — `globalThis` landed in Chrome 71 —
 * so React never mounts, `NativeBridge` never runs, and the person is left looking at the
 * exported static HTML: 29 CSS rules survived out of a 75 kB stylesheet, because the
 * Chrome-69 parser cannot open an `@layer` block and drops every rule inside one. Unstyled
 * markup with a working checkout somewhere inside it, exactly as predicted.
 *
 * The guard was written inside the very bundle that cannot parse. So this is the same
 * shape as `SPLASH_NET_SCRIPT` next to it: markup already in the document, in syntax old
 * enough to run wherever the app can be installed at all.
 *
 * WHY THIS IS REACHABLE. `minSdkVersion = 24`, so Android 7, 8 and 9 install it, and the
 * WebView version is not tied to the Android version anyway — it updates through the Play
 * Store, so a phone on Android 13 can be sitting on a 2020 WebView because nobody ever
 * updates anything.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *  - it does not replace the React gate. Chrome 71–110 parses the bundle fine and fails at
 *    CSS only; that case mounts, and `NativeBridge` handles it with a retry the static
 *    screen has no way to offer. This one covers the range below 71 that never gets there.
 *  - it does not fire outside a WebView. A desktop browser this old is somebody's problem,
 *    not this app's, and locking a web visitor out on a user-agent guess is a worse failure
 *    than the one it would prevent.
 *  - it does not translate. `NativeBridge` renders its twin outside `LocaleProvider` for
 *    the same reason: a screen that exists because the app failed cannot depend on the app.
 *
 * ES5 ONLY, and that is the whole point: `var`, no arrow functions, no template literals,
 * no optional chaining. A syntax error here is a blank screen on every device.
 */
export const WEBVIEW_MIN_CHROME = 111;

/** Kept identical to `WEBVIEW_BLOCK` in native-bridge.tsx — one failure, one wording. */
const TITLE = 'Perbarui Android System WebView';
const MESSAGE =
  'Aplikasi Hydromart butuh komponen WebView yang lebih baru agar tampil dengan benar. Perbarui lewat Play Store, lalu buka aplikasi ini lagi.';
const BUTTON = 'Buka Play Store';
const PACKAGE = 'com.google.android.webview';

// i18n-ok: the three strings above, for the reason in the header.
export const WEBVIEW_GATE_SCRIPT = [
  '(function(){try{',
  'var ua=navigator.userAgent;',
  // `; wv)` is the token Android puts in a WebView's user agent and nowhere else.
  'if(ua.indexOf("; wv)")<0)return;',
  'var m=/Chrome\\/(\\d+)/.exec(ua);',
  // No Chrome token means this is not a WebView we know how to judge. Never lock somebody
  // out on a guess — the same rule the React gate follows.
  'if(!m)return;',
  'if(+m[1]>=' + WEBVIEW_MIN_CHROME + ')return;',
  // Inline styles only: the stylesheet this screen exists because of is the one that did
  // not survive. Colours are plain hex for the same reason.
  'var w=function(){',
  'document.documentElement.removeAttribute("style");',
  'document.body.innerHTML="";',
  'document.body.setAttribute("style","margin:0;padding:24px;background:#faf9f5;color:#12303a;' +
    'font-family:-apple-system,Roboto,Arial,sans-serif;line-height:1.5");',
  'var d=document.createElement("div");',
  'd.setAttribute("style","max-width:420px;margin:15vh auto 0;text-align:center");',
  'var h=document.createElement("h1");',
  'h.setAttribute("style","font-size:20px;font-weight:800;margin:0 0 12px");',
  'h.appendChild(document.createTextNode(' + JSON.stringify(TITLE) + '));',
  'var p=document.createElement("p");',
  'p.setAttribute("style","font-size:15px;margin:0 0 24px");',
  'p.appendChild(document.createTextNode(' + JSON.stringify(MESSAGE) + '));',
  'var a=document.createElement("a");',
  'a.setAttribute("href","market://details?id=' + PACKAGE + '");',
  'a.setAttribute("style","display:inline-block;min-height:44px;line-height:44px;padding:0 24px;' +
    'border-radius:9999px;background:#12303a;color:#fff;font-weight:700;text-decoration:none");',
  'a.appendChild(document.createTextNode(' + JSON.stringify(BUTTON) + '));',
  'd.appendChild(h);d.appendChild(p);d.appendChild(a);document.body.appendChild(d);',
  // The splash is dismissed by JS and by nothing else, so a screen that renders under it
  // is a screen nobody sees. Same call the bridge makes, spelled out for a plugin bridge
  // that may or may not have loaded yet.
  'try{if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.SplashScreen)',
  'window.Capacitor.Plugins.SplashScreen.hide({fadeOutDuration:0});}catch(e2){}',
  '};',
  // `document.body` does not exist yet while this runs in `<head>`.
  'if(document.body)w();else document.addEventListener("DOMContentLoaded",w);',
  '}catch(e){}})();',
].join('');
