/**
 * 同梱スクリプトをサブコマンドで呼び出す。
 *
 *   docker compose run --rm tools setup-env
 *   docker compose run --rm tools s3-backup
 *   docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
 *
 * compose.yaml の使い捨てコンテナを tools 1本にまとめるための入口。
 * 呼び出し先を子プロセスとして起動するのは、各スクリプトが `process.argv` を直接読むため。
 * import で取り込むと argv を組み替える必要があり、単体実行との二重管理になる。
 */
import { spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMANDS = {
  'setup-env': 'setup-env/index.mjs',
  's3-backup': 'backup-s3.mjs',
  's3-restore': 'restore-s3.mjs',
}

const USAGE = `使い方: node scripts/tools.mjs <サブコマンド> [引数...]

  setup-env    設定ファイル(.env.docker / .env.db / seaweedfs-s3.json)を対話生成する
  s3-backup    オブジェクトストレージの中身を backup/ へバックアップする
  s3-restore   バックアップディレクトリの内容をオブジェクトストレージへ復元する
  help         この使い方を表示する

サブコマンドより後ろの引数はそのまま渡される(例: setup-env --dry-run)。
`

const [command, ...rest] = process.argv.slice(2)

if (command === undefined) {
  process.stderr.write(USAGE)
  process.exit(1)
}

if (command === 'help' || command === '--help' || command === '-h') {
  process.stdout.write(USAGE)
  process.exit(0)
}

// プロトタイプ由来のプロパティ(toString など)を拾わないよう、自身のキーだけを見る
if (!Object.hasOwn(COMMANDS, command)) {
  process.stderr.write(`不明なサブコマンドです: ${command}\n\n${USAGE}`)
  process.exit(1)
}
const script = COMMANDS[command]

// コンテナ内のパスを決め打ちにせず、このファイルの位置から解決する
const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

const { status, signal, error } = spawnSync(process.execPath, [path.join(scriptsDir, script), ...rest], {
  stdio: 'inherit',
})

if (error) {
  process.stderr.write(`${command} を起動できませんでした: ${error.message}\n`)
  process.exit(1)
}

// シグナルで終了した場合 status は null になるため、シェルの慣習に合わせて 128+シグナル番号を返す
process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : status)
