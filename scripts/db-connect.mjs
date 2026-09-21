/**
 * `backup-db.mjs` / `restore-db.mjs` が共有する、PostgreSQL への接続解決とコマンド組み立て。
 *
 * S3 のスクリプト対は単体でも動くようあえて共通化していないが、DB はリストアが
 * 「バックアップと同じ接続先・同じ解決規則」であることに依存するうえ、
 * 下記の落とし穴が非自明なため1箇所にまとめる。
 *
 * 接続先は `DATABASE_URL` から解決する(`POSTGRES_*` は見ない)。
 * 外部の PostgreSQL を使う構成でも同じスクリプトで動かすため。
 */
import { spawnSync } from 'node:child_process'

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

/** `backup-s3.mjs` と揃えた `YYYYMMDD_HHMMSS`(ローカル時刻) */
export const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
