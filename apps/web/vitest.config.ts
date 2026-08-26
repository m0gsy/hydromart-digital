import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Logic tests default to node; render tests opt into jsdom per-file via a
    // `// @vitest-environment jsdom` docblock (keeps the fast path fast).
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    /*
     * 5 seconds is Vitest's default and it is not enough for this suite under `--coverage`.
     * A render test that drives a form through `userEvent` — typing six digits, clicking,
     * awaiting a redirect — measured 4.2s on a quiet machine with v8 instrumentation on.
     * On a busy one, three of them lost to the clock in a single run while every assertion
     * in the file still held: the failures were all "timed out", none was a wrong answer,
     * and a test that had never touched the diff (`native-auth`) went red alongside them.
     *
     * A gate that goes red because the machine was busy teaches everyone to re-run it, and
     * that habit is what actually destroys a gate. Raising the budget weakens no assertion:
     * a genuinely hung test still fails, twenty seconds later.
     */
    testTimeout: 20_000,
    /*
     * Every one of the 18 services and both shared packages gate at 98%. apps/web — the
     * only code a customer actually touches, and the same code both APK binaries load
     * inside a WebView — gated at nothing at all, so a test could be deleted and CI would
     * still be green.
     *
     * The floors are the CURRENT measured numbers rounded down, not an aspiration: a
     * threshold nobody can meet gets removed within the week. They exist to ratchet — the
     * function number is low because most of `src/` is page components nothing renders in
     * a unit test, and lowering any of these is now a visible decision instead of a
     * silence. Raise them as coverage lands; never lower them to make a red run green.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      /*
       * Half a point of headroom, and it is not laziness — it is the difference between a
       * ratchet and a tripwire.
       *
       * These were set to the measured numbers with nothing to spare, and `main` went red
       * TWICE in one day on 82.97% and 82.99% against a floor of 83. Neither was a
       * regression; both were rounding. A gate that fails on rounding gets re-run until it
       * passes, and that habit is what actually destroys a coverage gate — the number stops
       * meaning anything long before anybody edits it.
       *
       * Half a point still catches what this exists to catch: a page or a module added with
       * no tests moves the total by several tenths at least. It does not catch a single
       * untested line, and it was never able to.
       *
       * Raise these when coverage lands. Lowering them is a visible decision — this comment
       * is the one that says why it was ever lowered.
       */
      /*
       * WHAT is measured, before how much of it. This was measuring 727 files of BUILD
       * OUTPUT — `mobile-out/`, `mobile-out-ops/`, `mobile-out-customer/`, the static
       * exports, every one of them at zero — which is why `functions` sat at 29% and had
       * to be floored at 28. They are gitignored, so they exist on a laptop that ran the
       * export and not on one that did not: the coverage number changed with the machine.
       *
       * The dictionaries go too, and for the opposite reason. 56 translation files carry
       * 13,561 statements — FIFTY-NINE PERCENT of everything under src — and they are data,
       * so they are 100% covered by definition. They cannot regress and they cannot be
       * tested wrong; all they did was dominate the average and hold the headline number up
       * while the code underneath it moved.
       */
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/lib/dictionaries/**'],
      /*
       * Calibrated on CI, not on a laptop — and that distinction is not pedantry.
       *
       * The same source, the same config, measured on both:
       *
       *              laptop (Node 25)   CI (Node 22)
       *   statements   74.9% of 9478     75.5% of 8453
       *   functions    56.2% of  801     51.3% of  850
       *
       * The TOTALS differ. v8 coverage is derived from the engine's own range output, so a
       * different V8 attributes statements and functions differently for identical code.
       * Floors set from a laptop are floors set against a machine nobody gates on: these
       * were, and CI refused them on four counts within the hour.
       *
       * CI reads 75.46 / 82.08 / 51.29 / 75.31, and these sit a point or so under, which is
       * the same ratchet-not-tripwire headroom the note above argues for.
       */
      thresholds: {
        statements: 74,
        branches: 81,
        functions: 50,
        lines: 74,
        /*
         * A second, higher floor for `src/lib/**` — the money, the API client, the offline
         * queue, the role map. A page rendering wrong is visible to anyone who opens it;
         * `lib` computing a discount wrong is not visible to anybody. One flat number
         * cannot say that, which is the whole argument for a second one.
         *
         * CI reads 76.77 / 85.6 / 42.03 / 76.65 here.
         */
        'src/lib/**': { statements: 76, branches: 84, functions: 41, lines: 76 },
      },
    },
  },
  // React 19 automatic JSX — esbuild transforms TSX, so no @vitejs/plugin-react needed.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
});
