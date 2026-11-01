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
  },
)
