module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh'],
  ignorePatterns: [
    'dist',
    'node_modules',
    'playwright-report',
    'test-results',
    '*.config.js',
    '*.d.ts',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }],
    // Off until phase 03 rewrites services/api.ts, which holds most of the untyped responses.
    '@typescript-eslint/no-explicit-any': 'off',
    // Only affects hot reload in development; several modules export constants next to components.
    'react-refresh/only-export-components': 'off',
  },
}
