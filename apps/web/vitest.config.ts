import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Logic tests default to node; render tests opt into jsdom per-file via a
    // `// @vitest-environment jsdom` docblock (keeps the fast path fast).
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
  // React 19 automatic JSX — esbuild transforms TSX, so no @vitejs/plugin-react needed.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
});
