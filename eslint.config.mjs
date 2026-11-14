import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import readability from './tooling/eslint/readability.mjs'
import typedRules from './tooling/eslint/typed-rules.mjs'

const frontendSources = ['frontend/src/**/*.{ts,tsx}']
// The frontend lints itself through frontend/eslint.config.js; these packages have no config of their own.
const packageSources = [
  'intake-server/src/**/*.ts',
  'media-decoder/src/**/*.ts',
  'contracts/src/**/*.ts',
]

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      '**/vectors/**',
      '**/fixtures/**',
      '**/migrations/**',
      '**/.temp/**',
      'backend/**',
      'spikes/**',
      'openspec/changes/**/spikes/**',
      'docs/**',
      '.agents/**',
      '.claude/**',
      '.codex/**',
      '.amp/**',
    ],
  },
  {
    ...readability,
    files: [...frontendSources, ...packageSources],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [...frontendSources, ...packageSources],
    // Frontend lint applies these rules itself; here they would only repeat it.
    ignores: config.rules ? frontendSources : [],
  })),
  {
    files: packageSources,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...typedRules,
      // TypeScript's noUnusedLocals already reports unused names; these options let rest siblings
      // and `_` names pass.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Frontend lint owns its rules and reports unused disables; knowing the plugins here keeps its
    // justified disable comments valid.
    files: frontendSources,
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
]
