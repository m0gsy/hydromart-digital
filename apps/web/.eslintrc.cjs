/* eslint 8 legacy config, matching the rest of the monorepo toolchain. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: { react: { version: 'detect' } },
  env: { browser: true, es2022: true, node: true },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  // `mobile-out-*/` is a build artefact, not source. Anyone who runs `build:mobile` before
  // linting otherwise gets ~200 files of minified chunk noise; CI never saw it only because
  // the export step runs after lint.
  ignorePatterns: ['.next/', 'node_modules/', 'next-env.d.ts', 'mobile-out/', 'mobile-out-*/'],
};
