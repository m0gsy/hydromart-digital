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
      thresholds: { statements: 83, branches: 62, functions: 28, lines: 83 },
    },
  },
  // React 19 automatic JSX — esbuild transforms TSX, so no @vitejs/plugin-react needed.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
});
