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
]
