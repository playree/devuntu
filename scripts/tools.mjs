/**
 * 同梱スクリプトをサブコマンドで呼び出す。
 *
 *   docker compose run --rm tools setup-env
 *   docker compose run --rm tools db-backup
 *   docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump
 *   docker compose run --rm tools s3-backup
 *   docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
 *   docker compose run --rm tools full-backup
 *   docker compose run --rm tools full-restore backup/full_YYYYMMDD_HHMMSS
 *   docker compose run --rm tools maintenance on
 *
 * compose.yaml の使い捨てコンテナを tools 1本にまとめるための入口。
 * 呼び出し先の起動は `run-script.mjs` に集約している。
 */
import { runScript } from './run-script.mjs'

const COMMANDS = {
  'setup-env': 'setup-env/index.mjs',
  'db-backup': 'backup-db.mjs',
  'db-restore': 'restore-db.mjs',
  's3-backup': 'backup-s3.mjs',
  's3-restore': 'restore-s3.mjs',
  'full-backup': 'backup-all.mjs',
  'full-restore': 'restore-all.mjs',
  maintenance: 'maintenance.mjs',
}

const USAGE = `使い方: node scripts/tools.mjs <サブコマンド> [引数...]

  setup-env     設定ファイル(.env.docker / .env.db / seaweedfs-s3.json)を対話生成する
  db-backup     データベースの中身を backup/ へバックアップする
  db-restore    ダンプファイルの内容をデータベースへ復元する
  s3-backup     オブジェクトストレージの中身を backup/ へバックアップする
  s3-restore    バックアップディレクトリの内容をオブジェクトストレージへ復元する
  full-backup   DB と S3 を backup/full_<stamp>/ へまとめてバックアップする
  full-restore  full-backup の出力から DB と S3 をまとめて復元する
  maintenance   メンテナンスモードを切り替える(on / off / status)
  help          この使い方を表示する

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

process.exit(runScript(COMMANDS[command], rest))
