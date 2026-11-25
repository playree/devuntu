import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config'
import { fileURLToPath } from 'node:url'

const eslintConfig = defineConfig([
  // git 管理外のもの(.work の作業ファイルなど)は対象にしない
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url)), '.gitignore'),
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.yarn/**',
    '**/generated/**/*',
    // GitHub Pages のソース。アプリとは別物なので Next.js 向けのルールをかけない
    'site/**',
  ]),
  {
    rules: {
      // `_` 始まりは「意図的に受け取るが使わない」印。
      // 分割代入で不要なキーを除外する用途で使う
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
])

export default eslintConfig
