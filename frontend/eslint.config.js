import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import readability from '../tooling/eslint/readability.mjs'

export default tseslint.config(
  { ignores: ['dist'] },
  readability,
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Omitting props from a rest spread names them without using them.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      // The barrel re-exports these modules; importing it from inside would form a cycle.
      'no-restricted-imports': [
        'error',
        {
          paths: ['#/components/ui', '#/components/ui/index', './index', '../index'].map(
            (name) => ({
              name,
              message: 'Import the sibling module directly.',
            }),
          ),
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
)
