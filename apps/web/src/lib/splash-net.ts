/**
 * E1, net 2 of 2 — the last thing that can hide the splash when nothing else is left.
 *
 * `launchAutoHide: false` means the splash is dismissed by JS and by nothing else. Two
 * different failures leave it up, and they need two different nets:
 *
 *   - the root layout throws. React is running; it just cannot render the tree. The error
 *     screen hides the splash itself (`global-error.tsx`).
 *   - React never runs AT ALL: a chunk 404s behind a captive portal, or an old WebView
 *     rejects the syntax before hydration. No component mounts, so no component can help
 *     — a `setTimeout` inside `NativeBridge` is useless here, because `NativeBridge` is
 *     one of the things that did not mount. Only markup already in the document can act,
 *     which is why this is an inline <script> in <head> and not a component.
 *
 * A fixed 8s: long enough that it never races a slow-but-working cold start into hiding
 * the splash early, short enough that nobody concludes the app is broken and uninstalls.
 * Hiding a splash that is already hidden is a no-op, so the happy path pays nothing.
 *
 * Written as a string rather than a function because it must survive being inlined into
 * HTML before any bundle loads. Kept in its own module so it can be executed by a test —
 * a net nobody has ever seen fire is not a net.
 */
export const SPLASH_NET_MS = 8000;

export const SPLASH_NET_SCRIPT =
  `setTimeout(function(){try{` +
  `var c=window.Capacitor,p=c&&c.Plugins,s=p&&p.SplashScreen;` +
  `if(s&&typeof s.hide==='function')s.hide({fadeOutDuration:200});` +
  `}catch(e){}},${SPLASH_NET_MS})`;
