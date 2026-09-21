/**
 * 兄弟スクリプトを子プロセスで起動し、終了コードを呼び出し元へ伝える。
 *
 * 子プロセスにするのは、各スクリプトが `process.argv` を直接読むため。
 * import で取り込むと argv を組み替える必要があり、単体実行との二重管理になる。
 *
 * `tools.mjs`(サブコマンドの入口)と `backup-all.mjs` / `restore-all.mjs`(対の実行)が共有する。
 */
import { spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// コンテナ内のパスを決め打ちにせず、このファイルの位置から解決する
const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * `scripts/` 配下のスクリプトを実行し、終了コードを返す。
 *
 * @param {string} script `scripts/` からの相対パス(例: `backup-db.mjs`)
 * @param {string[]} [args] そのまま渡す引数
 * @returns {number} 終了コード
 */
export const runScript = (script, args = []) => {
  const { status, signal, error } = spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
    stdio: 'inherit',
  })

  if (error) {
    process.stderr.write(`${script} を起動できませんでした: ${error.message}\n`)
    return 1
  }

  // シグナルで終了した場合 status は null になるため、シェルの慣習に合わせて 128+シグナル番号を返す
  return signal ? 128 + (constants.signals[signal] ?? 0) : status
}
