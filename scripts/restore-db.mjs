/**
 * `backup-db.mjs` が出力したダンプを PostgreSQL へ復元する。
 *
 *   pnpm db:restore backup/devuntu_YYYYMMDD_HHMMSS.dump
 *
 * Docker環境では compose.yaml の tools サービスで実行する(手順は docs/operations.md 参照)。
 *
 *   docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump
 *
 * `--wait <秒>` を付けると、対象DBへの他の接続が解放されるまでその秒数まで待つ
 * (メンテナンスモードにした直後など。既定は待たずに中断)。
 *
 * 接続先は `DATABASE_URL`、実行経路の切り替えは `db-connect.mjs` を参照。
 */
import { closeSync, existsSync, openSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { hasLocalPgClient, resolveDbEnv, runPg, showTransport } from './db-connect.mjs'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

/**
 * 接続中のDBは DROP できないため、DROP/CREATE と接続数の確認は対象とは別のDB経由で行う。
 * 対象が `postgres` 自身の場合は、同じく既定で接続できる `template1` へ逃がす
 */
const maintenanceDb = (pgEnv) => (pgEnv.PGDATABASE === 'postgres' ? 'template1' : 'postgres')

/** SQLリテラル・識別子の埋め込み。DB名は `DATABASE_URL` 由来だが、引用符を含む名前でも壊れないようにする */
const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`
const sqlIdent = (value) => `"${value.replaceAll('"', '""')}"`

const usage = () => {
  console.error('Usage: node ./scripts/restore-db.mjs <dump-file> [--force] [--wait <秒>]')
  console.error('Example: node ./scripts/restore-db.mjs backup/devuntu_20260719_120000.dump')
}

/** 対象DBへの他の接続の数 */
const countOtherConnections = (pgEnv) => {
  const sql = `SELECT count(*) FROM pg_stat_activity WHERE datname = ${sqlLiteral(pgEnv.PGDATABASE)} AND pid <> pg_backend_pid()`
  const res = runPg('psql', ['-Atc', sql], { pgEnv, database: maintenanceDb(pgEnv), capture: true })
  const count = Number.parseInt(res.stdout.trim(), 10)
  return Number.isNaN(count) ? 0 : count
}

/**
 * 対象DBへの他の接続が残っていないか確認する。
 *
 * `devuntu` は `restart: unless-stopped` のため、止めずに進めると `DROP DATABASE` の
 * 直後に接続を張り直し、復元後も Prisma の接続プールが古い状態を握る。
 * tools サービスのコンテナ内からは `docker compose stop` ができないので、
 * 警告ではなく中断して利用者に止めてもらう。
 *
 * メンテナンスモード(`maintenance.mjs`)でも接続は解放されるが、アプリが遮断に気づくまでの
 * 遅れと、実行中のワーカーが処理を終えるまでの時間がある。`--wait` はその間を待つためのもので、
 * 固定時間の見切り発車ではなく**接続数が 0 になったこと**を確かめてから進む。
 * 上限まで残っていれば中断するので、長い処理を抱えたまま復元を始めてしまうことはない。
 */
const assertNoOtherConnections = async (pgEnv, waitSec) => {
  const deadline = Date.now() + waitSec * 1000
  let count = countOtherConnections(pgEnv)
  if (count > 0 && waitSec > 0) {
    console.log(`${pgEnv.PGDATABASE} の接続が解放されるまで待ちます(最大 ${waitSec} 秒)...`)
    while (count > 0 && Date.now() < deadline) {
      await sleep(1000)
      count = countOtherConnections(pgEnv)
    }
  }
  if (count === 0) {
    return
  }
  console.error(`${pgEnv.PGDATABASE} に他の接続が ${count} 件残っています。`)
  console.error('先に `pnpm maintenance on` で遮断するか、`docker compose stop devuntu` で止めてから')
  console.error('実行してください(--force で無視できます)。')
  process.exit(1)
}

/** `--wait <秒>` の値。無ければ 0(待たずに即中断) */
const parseWait = (args) => {
  const index = args.indexOf('--wait')
  if (index < 0) {
    return 0
  }
  const value = Number(args[index + 1])
  if (!Number.isFinite(value) || value < 0) {
    console.error('--wait には待つ秒数を指定してください')
    process.exit(1)
  }
  return value
}

const main = async () => {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const waitSec = parseWait(args)
  // `--wait` の値はオプションの一部なので、ダンプファイルとして拾わない
  const waitIndex = args.indexOf('--wait')
  const valueIndex = waitIndex >= 0 ? waitIndex + 1 : -1
  const dumpFile = args.find((arg, index) => !arg.startsWith('--') && index !== valueIndex)

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
    await assertNoOtherConnections(pgEnv, waitSec)
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
    { pgEnv, database: maintenanceDb(pgEnv) },
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

await main()
