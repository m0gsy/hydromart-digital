import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest doesn't auto-register RTL cleanup (no globals) — do it once here so
// mounted trees don't leak across tests.
afterEach(cleanup);

// `findBy*` and `waitFor` give up after 1s by default. Under `--coverage` on a busy machine (and
// on the shared CI runner) a render that fetches before it draws can take longer than that, and
// the test fails with "Unable to find …" although nothing is wrong: two unrelated files did
// exactly that in the same run. A longer ceiling costs nothing when the element appears, and a
// genuinely missing one still fails, five seconds later (see also `testTimeout` in vitest.config).
configure({ asyncUtilTimeout: 5000 });

// Vitest's jsdom environment hands over `window.localStorage` as a bare object with none
// of Storage's methods on it, so any code that persists something throws `setItem is not
// a function` — in a `try/catch` it looks like the browser refused, which is worse than a
// failure. Real browsers and the Android WebView both have the real thing; this only
// restores what the test environment dropped. Node-environment tests have no window and
// skip it.
if (typeof window !== 'undefined' && typeof window.localStorage?.setItem !== 'function') {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
