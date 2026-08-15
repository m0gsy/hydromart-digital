/**
 * Keep the native safe-area insets across a navigation.
 *
 * Capacitor's `SystemBars` writes `--safe-area-inset-*` onto `document.documentElement`
 * with `style.setProperty`, from a window-insets listener. In an EXPORTED build every route
 * is its own `index.html`, so a navigation builds a new `documentElement` — and the inline
 * style goes with the old one. Nothing re-applies it until the insets change again, which
 * on a phone held still is never.
 *
 * Measured inside the APK on a WebView-124 emulator: `--safe-area-inset-top` is `0px` on the
 * first document and `(unset)` on every screen after it. Both are zero there, so nothing
 * shows — but on a notched device below WebView 140, where `env()` is also 0 and the plugin
 * value is the only real number, it means the top inset applies until the first navigation
 * and then vanishes.
 *
 * So: remember the last non-zero values, and put them back on a document that has none.
 * `sessionStorage` rather than `localStorage` — an inset belongs to this run of the app on
 * this device orientation, not to the account forever.
 */
const KEY = 'hydromart.safeAreaInsets';
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

const read = (root: HTMLElement, side: string) =>
  getComputedStyle(root).getPropertyValue(`--safe-area-inset-${side}`).trim();

/** Runs once per document. Safe to call outside a browser; it simply does nothing. */
export function persistSafeAreaInsets(): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  const root = document.documentElement;

  const apply = () => {
    const live: Record<string, string> = {};
    for (const side of SIDES) {
      const value = read(root, side);
      if (value) live[side] = value;
    }
    // A document that already has them is the source of truth — record and stop.
    if (Object.values(live).some((v) => v && v !== '0px')) {
      sessionStorage.setItem(KEY, JSON.stringify(live));
      return;
    }
    const saved = sessionStorage.getItem(KEY);
    if (!saved) return;
    try {
      const insets = JSON.parse(saved) as Record<string, string>;
      for (const side of SIDES) {
        // Only fill a side that is genuinely absent. Overwriting a real 0 with a remembered
        // number would be inventing an inset the device is not reporting.
        if (!read(root, side) && insets[side]) {
          root.style.setProperty(`--safe-area-inset-${side}`, insets[side]);
        }
      }
    } catch {
      sessionStorage.removeItem(KEY);
    }
  };

  apply();
  // The plugin writes its values a tick or two after the document exists, so the first pass
  // can legitimately see nothing. One re-check beats a guess about the ordering.
  window.setTimeout(apply, 400);
}
