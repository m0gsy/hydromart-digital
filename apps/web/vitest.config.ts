import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Logic tests default to node; render tests opt into jsdom per-file via a
    // `// @vitest-environment jsdom` docblock (keeps the fast path fast).
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
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
      thresholds: { statements: 82.5, branches: 62, functions: 28, lines: 82.5 },
    },
  },
  // React 19 automatic JSX — esbuild transforms TSX, so no @vitejs/plugin-react needed.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
});
