import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import { defineConfig, globalIgnores } from 'eslint/config'
import { version as reactVersion } from 'react/package.json'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      /**
       * eslint-config-next の既定は 'detect' だが、eslint-plugin-react の検出処理が
       * ESLint v10 で削除された `context.getFilename()` を呼ぶためクラッシュする。
       * プラグインが v10 対応したら削除する
       */
      react: { version: reactVersion },
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.yarn/**',
    '**/generated/**/*',
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
