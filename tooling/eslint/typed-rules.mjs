/**
 * Type-aware rules shared by the frontend and the server packages. They need a TypeScript
 * project, so each config applies them only to files its tsconfig includes.
 */
export default {
  // An unhandled rejection loses its failure; await it, return it or mark it with `void`.
  '@typescript-eslint/no-floating-promises': 'error',
  // JSX event props may take async handlers; elsewhere a void callback must not get a promise.
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
  '@typescript-eslint/await-thenable': 'error',
  // A new union member then fails lint wherever a switch does not handle it.
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
}
