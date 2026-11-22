module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended-legacy',
    'prettier'
  ],
  ignorePatterns: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'security'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    'security/detect-object-injection': 'off'
  }
};
