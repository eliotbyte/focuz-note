import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Pragmatic defaults for this codebase (lots of intentional empty catches + JSON-ish payloads).
      'no-empty': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    },
  },
  // Architectural boundary: UI must not import IndexedDB/Dexie layer directly.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/**', 'src/data/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/lib/db', '**/lib/db.ts'],
            message: 'Do not import IndexedDB/Dexie directly from UI. Use src/data/* (repository layer).',
          },
        ],
      }],
    },
  },
  // UI foundations: Radix must be headless only (no themes) and isolated behind primitives.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@radix-ui/react-*'],
            message: 'Do not import Radix primitives directly outside src/components/ui. Use UI primitives wrappers instead.',
          },
        ],
        paths: [
          {
            name: '@radix-ui/themes',
            message: 'Radix in this project is headless only. Use @radix-ui/react-* primitives + custom CSS.',
          },
        ],
      }],
    },
  },
  // Toast infrastructure: Sonner must be imported only by UI-infra module(s).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'sonner', message: 'Import sonner only from src/ui/** (UI infrastructure). Other modules should call ui/notify.' },
        ],
      }],
    },
  },
])
