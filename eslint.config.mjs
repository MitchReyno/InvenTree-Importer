import reactHooks from 'eslint-plugin-react-hooks'
import readability from './tooling/eslint/readability.mjs'

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
    files: [
      'frontend/src/**/*.{ts,tsx}',
      'intake-server/src/**/*.ts',
      'media-decoder/src/**/*.ts',
      'contracts/src/**/*.ts',
    ],
  },
  {
    // Frontend lint owns these rules and reports its unused disable comments; here they are only known.
    files: ['frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
]
