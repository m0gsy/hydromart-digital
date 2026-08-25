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

/**
 * Runs once per document. Safe to call outside a browser; it simply does nothing.
 *
 * Returns a disposer for the watcher below. It used to be an uncancellable timer, which is
 * a leak in the app and an outright crash in a test: it fired 400ms later, after the jsdom
 * document had been torn down, and took the whole suite's exit code with it
 * (`getComputedStyle is not defined`) while every one of the 656 tests passed.
 */
export function persistSafeAreaInsets(): () => void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return () => {};
  const root = document.documentElement;

  /** True once there is an answer — live insets recorded, or saved ones put back. */
  const apply = (): boolean => {
    const live: Record<string, string> = {};
    for (const side of SIDES) {
      const value = read(root, side);
      if (value) live[side] = value;
    }
    // A document that already has them is the source of truth — record and stop.
    if (Object.values(live).some((v) => v && v !== '0px')) {
      sessionStorage.setItem(KEY, JSON.stringify(live));
      return true;
    }
    const saved = sessionStorage.getItem(KEY);
    if (!saved) return false;
    try {
      const insets = JSON.parse(saved) as Record<string, string>;
      let restored = false;
      for (const side of SIDES) {
        // Only fill a side that is genuinely absent. Overwriting a real 0 with a remembered
        // number would be inventing an inset the device is not reporting.
        if (!read(root, side) && insets[side]) {
          root.style.setProperty(`--safe-area-inset-${side}`, insets[side]);
          restored = true;
        }
      }
      return restored;
    } catch {
      sessionStorage.removeItem(KEY);
      return false;
    }
  };

  /*
   * J5. Two shots inside a 400 ms window was a guess about the ordering, and it was the
   * wrong kind of guess: if the plugin writes its insets at 500 ms — a cold start, a slow
   * device, a WebView still warming up — nothing looks again, ever, and the app bar sits
   * under the status bar for the whole session.
   *
   * `style.setProperty` on `documentElement` is exactly what the plugin does, and a
   * MutationObserver on that attribute is exactly when it happens. No polling interval to
   * pick, no window to be wrong about, and it stops the moment there is an answer.
   *
   * It still stops on a deadline. A device that genuinely has no insets never writes any,
   * and an observer left running for the life of the document to wait for something that
   * is never coming is a leak dressed as caution.
   */
  const STOP_AFTER_MS = 10_000;
  let stopped = false;
  let observer: MutationObserver | null = null;
  let timer = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    window.clearTimeout(timer);
  };

  if (apply()) return stop;
  if (typeof MutationObserver === 'undefined') {
    // No observer (an old engine, or a test environment without one): keep the original
    // single re-check rather than nothing at all.
    timer = window.setTimeout(apply, 400);
    return stop;
  }

  observer = new MutationObserver(() => {
    // `apply` writes to the same attribute when it restores, which would re-enter here —
    // but it only ever does that on a pass that returns true, and that pass stops us.
    if (apply()) stop();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });
  timer = window.setTimeout(stop, STOP_AFTER_MS);
  return stop;
}
