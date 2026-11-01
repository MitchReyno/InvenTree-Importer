import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

// Match the declaration itself, including exports, without matching nested callbacks.
const callableDeclaration = {
  selector: [
    'FunctionDeclaration',
    'ExportNamedDeclaration[declaration.type="FunctionDeclaration"]',
    'ExportDefaultDeclaration[declaration.type="FunctionDeclaration"]',
    'VariableDeclaration[declarations.0.init.type="ArrowFunctionExpression"]',
    'VariableDeclaration[declarations.0.init.type="FunctionExpression"]',
    'ExportNamedDeclaration[declaration.declarations.0.init.type="ArrowFunctionExpression"]',
    'ExportNamedDeclaration[declaration.declarations.0.init.type="FunctionExpression"]',
  ].join(', '),
}

export default {
  files: ['**/*.{ts,tsx}'],
  languageOptions: { parser: tseslint.parser },
  plugins: { '@stylistic': stylistic },
  rules: {
    curly: ['error', 'all'],
    'one-var': ['error', 'never'],
    '@stylistic/padding-line-between-statements': [
      'error',
      { blankLine: 'always', prev: '*', next: callableDeclaration },
      { blankLine: 'always', prev: callableDeclaration, next: '*' },
      // A TypeScript overload group is one declaration, not separate functions.
      {
        blankLine: 'any',
        prev: {
          selector:
            'TSDeclareFunction, ExportNamedDeclaration[declaration.type="TSDeclareFunction"]',
        },
        next: '*',
      },
    ],
    '@stylistic/lines-between-class-members': [
      'error',
      {
        enforce: [
          { blankLine: 'always', prev: '*', next: 'method' },
          { blankLine: 'always', prev: 'method', next: '*' },
        ],
      },
      { exceptAfterOverload: true },
    ],
  },
}
