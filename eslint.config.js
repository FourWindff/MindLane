import eslint from '@eslint/js'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

const typescriptFiles = ['**/*.{ts,tsx}']

export default [
  {
    ignores: ['dist/**', 'dist-electron/**', '.worktrees/**'],
  },
  {
    ...eslint.configs.recommended,
    files: typescriptFiles,
  },
  ...typescriptEslint.configs['flat/recommended'].map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: typescriptFiles,
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    ...prettier,
    files: typescriptFiles,
  },
]
