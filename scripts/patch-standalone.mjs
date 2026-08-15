/**
 * standalone 出力に不足する `@swc/helpers` の ESM 実装を補う。`pnpm build`(next build の後)で自動実行される。
 *
 * next の dist(CJS)は `require('@swc/helpers/_/_interop_require_default')` を使う。
 * `@swc/helpers` 0.5.23 の exports は `module-sync` 条件を先頭に持つため、require(esm) が有効な Node では
 * require であっても `esm/*.js` に解決される。一方 Turbopack のファイルトレースは require 条件で解決するので
 * standalone には `cjs/*.cjs` しか同梱されず、`node server.js` が MODULE_NOT_FOUND で起動できない。
 *
 * next 側で解決されたら(トレースが esm を含む、または `@swc/helpers` から `module-sync` が消える)この処理ごと削除する。
 */
import { cp, readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const standaloneDir = path.join(projectRoot, '.next', 'standalone')

const exists = async (target) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

if (!(await exists(standaloneDir))) {
  console.log('[patch-standalone] .next/standalone が無いためスキップした')
  process.exit(0)
}

// next から見た実体を解決する(pnpm のバージョン付きディレクトリ名をハードコードしないため)
const nextRequire = createRequire(import.meta.resolve('next/package.json'))
const helpersDir = path.dirname(nextRequire.resolve('@swc/helpers/package.json'))
const esmSrc = path.join(helpersDir, 'esm')

if (!(await exists(esmSrc))) {
  throw new Error(`@swc/helpers の esm ディレクトリが見つからない: ${esmSrc}`)
}

const relative = path.relative(projectRoot, helpersDir)
if (relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error(`@swc/helpers がプロジェクト外にあるためコピー先を決められない: ${helpersDir}`)
}

const esmDest = path.join(standaloneDir, relative, 'esm')
await cp(esmSrc, esmDest, { recursive: true })

const files = await readdir(esmDest)
console.log(
  `[patch-standalone] @swc/helpers/esm を ${files.length} ファイルコピーした: ${path.relative(projectRoot, esmDest)}`,
)
