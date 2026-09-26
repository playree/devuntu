/**
 * `backup-db.mjs` / `restore-db.mjs` / `backup-all.mjs` が共有する、PostgreSQL への接続解決とコマンド組み立て。
 *
 * S3 のスクリプト対は単体でも動くようあえて共通化していないが、DB はリストアが
 * 「バックアップと同じ接続先・同じ解決規則」であることに依存するうえ、
 * 下記の落とし穴が非自明なため1箇所にまとめる。
 *
 * 接続先は `DATABASE_URL` から解決する(`POSTGRES_*` は見ない)。
 * 外部の PostgreSQL を使う構成でも同じスクリプトで動かすため。
 */
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * `DATABASE_URL` を libpq 用の `PG*` 環境変数へ分解する。
 *
 * URL をそのまま libpq へ渡せない: `.env` / `.env.docker` の `DATABASE_URL` には
 * Prisma 固有の `?schema=public` が付いており、libpq は未知のクエリパラメータをエラーにする。
 * 環境変数にするのは、パスワードが `ps` から見える argv に載らないようにするためでもある。
 *
 * `setup-env/spec.mjs` の `parseDatabaseUrl` は対話の既定値用(`host` をポート込みの文字列で返す)
 * なので流用せず、ここで別に分解する。
 */
export const resolveDbEnv = (databaseUrl) => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL が設定されていません')
  }

  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL を接続URLとして解釈できません')
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const user = decodeURIComponent(url.username)
  // IPv6 リテラルは URL 側が `[::1]` の形で返すが、libpq は角括弧を含まない形を取る
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (!host || !database || !user) {
    throw new Error('DATABASE_URL にホスト・ユーザー・DB名のいずれかが含まれていません')
  }

  /** @type {Record<string, string>} */
  const env = {
    PGHOST: host,
    PGPORT: url.port || '5432',
    PGUSER: user,
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  }

  const sslmode = url.searchParams.get('sslmode')
  if (sslmode) {
    env.PGSSLMODE = sslmode
  }
  return env
}

/**
 * ローカルに postgres クライアントがあるか。
 *
 * イメージには `postgresql-client` を同梱しているので、`tools` サービスからは常に true になる。
 * clone した開発環境でホストにクライアントを入れていない場合に false となり、
 * 従来どおり `docker compose exec` 経由へ倒す。
 */
let localClient
export const hasLocalPgClient = () => {
  if (localClient === undefined) {
    localClient = spawnSync('pg_dump', ['--version'], { stdio: 'ignore' }).status === 0
  }
  return localClient
}

/**
 * `docker compose exec -T db` 経路で扱える接続先か。
 *
 * この経路はコンテナ内のローカル接続になり、`PGHOST` / `PGPORT` を渡せない。
 * 外部の PostgreSQL を指す `DATABASE_URL` でそのまま倒すと、バックアップは同梱 db の中身を取り、
 * リストアは同梱 db を `DROP DATABASE` してしまうため、同梱 db 以外は拒否する。
 *
 * `db` は compose ネットワーク内から、loopback は `127.0.0.1:5432` のホスト公開からの接続。
 */
const BUNDLED_DB_HOSTS = new Set(['db', 'localhost', '127.0.0.1', '::1'])
export const isBundledDbHost = (pgEnv) => BUNDLED_DB_HOSTS.has(pgEnv.PGHOST)

/** 実行経路を1度だけ表示する(どちらで動いたか分からないまま失敗するのを避ける) */
let transportShown = false
export const showTransport = () => {
  if (transportShown) {
    return
  }
  transportShown = true
  console.log(hasLocalPgClient() ? 'using local postgres client' : 'using docker compose exec -T db')
}

/**
 * postgres クライアントの実行内容を組み立てる。
 *
 * `docker compose exec` 側はコンテナ内のローカル接続になるためパスワードは要らず、
 * `-U` でユーザーを指定する。`database` を省略すると `DATABASE_URL` の DB を対象にする。
 */
export const buildPgCommand = (bin, args, { pgEnv, database }) => {
  const db = database ?? pgEnv.PGDATABASE
  if (hasLocalPgClient()) {
    return { command: bin, args: ['-d', db, ...args], env: { ...process.env, ...pgEnv, PGDATABASE: db } }
  }
  if (!isBundledDbHost(pgEnv)) {
    throw new Error(
      `DATABASE_URL の接続先 (${pgEnv.PGHOST}) は同梱の db サービスではないため、docker compose exec では扱えません。` +
        '実行するホストに postgresql-client を入れてください',
    )
  }
  return {
    command: 'docker',
    args: ['compose', 'exec', '-T', 'db', bin, '-U', pgEnv.PGUSER, '-d', db, ...args],
    env: process.env,
  }
}

/** 組み立てたコマンドを同期実行し、失敗したら例外にする */
export const runPg = (bin, args, { pgEnv, database, stdio = 'inherit', capture = false }) => {
  const { command, args: argv, env } = buildPgCommand(bin, args, { pgEnv, database })
  const res = spawnSync(command, argv, {
    env,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : stdio,
    encoding: 'utf8',
  })

  if (res.error?.code === 'ENOENT') {
    throw new Error(
      hasLocalPgClient()
        ? `${bin} を実行できませんでした: ${res.error.message}`
        : `${bin} が見つからず、docker も使えませんでした。postgresql-client を入れるか、compose.yaml のあるディレクトリで実行してください`,
    )
  }
  if (res.error) {
    throw new Error(`${bin} を起動できませんでした: ${res.error.message}`)
  }
  if (res.status !== 0) {
    throw new Error(`${bin} が失敗しました (exit ${res.status})`)
  }
  return res
}

/**
 * 接続中のDBは DROP できないため、DROP/CREATE と接続数の確認は対象とは別のDB経由で行う。
 * 対象が `postgres` 自身の場合は、同じく既定で接続できる `template1` へ逃がす
 */
export const maintenanceDb = (pgEnv) => (pgEnv.PGDATABASE === 'postgres' ? 'template1' : 'postgres')

/** SQLリテラルの埋め込み。DB名は `DATABASE_URL` 由来だが、引用符を含む名前でも壊れないようにする */
export const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`

/** 対象DBへの他の接続の数 */
const countOtherConnections = (pgEnv) => {
  const sql = `SELECT count(*) FROM pg_stat_activity WHERE datname = ${sqlLiteral(pgEnv.PGDATABASE)} AND pid <> pg_backend_pid()`
  const res = runPg('psql', ['-Atc', sql], { pgEnv, database: maintenanceDb(pgEnv), capture: true })
  const count = Number.parseInt(res.stdout.trim(), 10)
  return Number.isNaN(count) ? 0 : count
}

/**
 * 対象DBへの他の接続が解放されるまで最大 `waitSec` 秒待ち、残った接続数を返す(0 なら解放済み)。
 *
 * メンテナンスモードにしても、アプリが遮断に気づくまでの遅れと、実行中のワーカーが処理を終えるまでの
 * 時間がある。固定時間の見切り発車ではなく**接続数が 0 になったこと**を確かめるためのもの
 * (アプリは実行中のワーカーが終わってから接続を手放すので、0 ならワーカーも完了済み)。
 */
export const waitForNoOtherConnections = async (pgEnv, waitSec) => {
  const deadline = Date.now() + waitSec * 1000
  let count = countOtherConnections(pgEnv)
  if (count > 0 && waitSec > 0) {
    console.log(`${pgEnv.PGDATABASE} の接続が解放されるまで待ちます(最大 ${waitSec} 秒)...`)
    while (count > 0 && Date.now() < deadline) {
      await sleep(1000)
      count = countOtherConnections(pgEnv)
    }
  }
  return count
}

/** `backup-s3.mjs` と揃えた `YYYYMMDD_HHMMSS`(ローカル時刻) */
export const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
