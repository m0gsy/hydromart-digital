module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: { project: 'tsconfig.json', tsconfigRootDir: __dirname, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['plugin:@typescript-eslint/recommended', 'prettier'],
  root: true,
  env: { node: true },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules'],
  overrides: [
    {
      // Q-5 is about the process dying on an unhandled rejection, which is a
      // production concern: a controller spec that calls an async method against a
      // synchronously-resolving mock is not that. Enforcing it here would have meant
      // 89 mechanical `void`s across two services, which hides the ordering bugs the
      // rule is worth having for. Enforced in src/, not in the suite.
      files: ['test/**/*.ts', '**/*.spec.ts'],
      rules: { '@typescript-eslint/no-floating-promises': 'off' },
    },
  ],
  rules: {
    // Q-5: a rejected promise nobody awaits is an unhandled rejection, and Node
    // exits the process on those. Type-aware, so it catches the real ones; a
    // deliberate fire-and-forget must say so with `void` + its own `.catch`.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
