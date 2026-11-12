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
    // Frontend lint owns these rules and reports unused disables; knowing them keeps its react-hooks
    // disables valid here. A disable for another plugin's rule would still fail this config.
    files: ['frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
]
