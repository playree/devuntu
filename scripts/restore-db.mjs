/**
 * `backup-db.mjs` が出力したダンプを PostgreSQL へ復元する。
 *
 *   pnpm db:restore backup/devuntu_YYYYMMDD_HHMMSS.dump
 *
 * Docker環境では compose.yaml の tools サービスで実行する(手順は docs/operations.md 参照)。
 *
 *   docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump
 *
 * 接続先は `DATABASE_URL`、実行経路の切り替えは `db-connect.mjs` を参照。
 */
import { closeSync, existsSync, openSync } from 'node:fs'
import { hasLocalPgClient, resolveDbEnv, runPg, showTransport } from './db-connect.mjs'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

/** 接続中のDBは DROP できないため、DROP/CREATE と接続数の確認はこのDB経由で行う */
const MAINTENANCE_DB = 'postgres'

/** SQLリテラル・識別子の埋め込み。DB名は `DATABASE_URL` 由来だが、引用符を含む名前でも壊れないようにする */
const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`
const sqlIdent = (value) => `"${value.replaceAll('"', '""')}"`

const usage = () => {
  console.error('Usage: node ./scripts/restore-db.mjs <dump-file> [--force]')
  console.error('Example: node ./scripts/restore-db.mjs backup/devuntu_20260719_120000.dump')
}

/**
 * 対象DBへの他の接続が残っていないか確認する。
 *
 * `devuntu` は `restart: unless-stopped` のため、止めずに進めると `DROP DATABASE` の
 * 直後に接続を張り直し、復元後も Prisma の接続プールが古い状態を握る。
 * tools サービスのコンテナ内からは `docker compose stop` ができないので、
 * 警告ではなく中断して利用者に止めてもらう。
 */
const assertNoOtherConnections = (pgEnv) => {
  const sql = `SELECT count(*) FROM pg_stat_activity WHERE datname = ${sqlLiteral(pgEnv.PGDATABASE)} AND pid <> pg_backend_pid()`
  const res = runPg('psql', ['-Atc', sql], { pgEnv, database: MAINTENANCE_DB, capture: true })
  const count = Number.parseInt(res.stdout.trim(), 10)
  if (Number.isNaN(count) || count === 0) {
    return
  }
  console.error(`${pgEnv.PGDATABASE} に他の接続が ${count} 件残っています。`)
  console.error('先に `docker compose stop devuntu` でアプリを止めてから実行してください(--force で無視できます)。')
  process.exit(1)
}

const main = () => {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const dumpFile = args.find((arg) => !arg.startsWith('--'))

  if (!dumpFile) {
    usage()
    process.exit(1)
  }
  if (!existsSync(dumpFile)) {
    console.error(`File not found: ${dumpFile}`)
    process.exit(1)
  }

  const pgEnv = resolveDbEnv(process.env.DATABASE_URL)
  showTransport()

  if (!force) {
    assertNoOtherConnections(pgEnv)
  }

  console.log(`Restoring ${dumpFile} into ${pgEnv.PGDATABASE} (database will be recreated)...`)

  // DBを一度作り直してから空のDBへ復元する。
  // --clean 方式だと「ダンプに含まれるオブジェクト」しか DROP されず、
  // ダンプに無い既存テーブル(例: 後から追加した calendar_share)とその外部キーが
  // 残って依存エラー(user_pkey を DROP できない等)になるため、DB再作成方式を採る。
  // 残った接続は WITH (FORCE) で強制切断する(PostgreSQL 13+)。
  runPg(
    'psql',
    [
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DROP DATABASE IF EXISTS ${sqlIdent(pgEnv.PGDATABASE)} WITH (FORCE);`,
      '-c',
      `CREATE DATABASE ${sqlIdent(pgEnv.PGDATABASE)} OWNER ${sqlIdent(pgEnv.PGUSER)};`,
    ],
    { pgEnv, database: MAINTENANCE_DB },
  )

  // --single-transaction: 全体を1トランザクション化(--exit-on-error を含む)。
  //   途中でエラーが出たら全ロールバックし、FK欠落などの半端な状態を残さない。
  const restoreArgs = ['--no-owner', '--single-transaction']
  if (hasLocalPgClient()) {
    runPg('pg_restore', [...restoreArgs, dumpFile], { pgEnv })
  } else {
    // コンテナ内からはホストのファイルを開けないので、標準入力で渡す
    const fd = openSync(dumpFile, 'r')
    try {
      runPg('pg_restore', restoreArgs, { pgEnv, stdio: [fd, 'inherit', 'inherit'] })
    } finally {
      closeSync(fd)
    }
  }

  console.log('Restore completed.')
}

main()
