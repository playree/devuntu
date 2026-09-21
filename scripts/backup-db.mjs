/**
 * PostgreSQL の中身をローカルへバックアップする。
 *
 *   pnpm db:backup
 *
 * Docker環境では compose.yaml の tools サービスで実行する(手順は docs/operations.md 参照)。
 *
 *   docker compose run --rm tools db-backup
 *
 * 接続先は `DATABASE_URL`、実行経路の切り替えは `db-connect.mjs` を参照。
 */
import { closeSync, mkdirSync, openSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { hasLocalPgClient, resolveDbEnv, runPg, showTransport, stamp } from './db-connect.mjs'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

const BACKUP_DIR = path.join(process.cwd(), 'backup')

const main = () => {
  const pgEnv = resolveDbEnv(process.env.DATABASE_URL)
  showTransport()

  mkdirSync(BACKUP_DIR, { recursive: true })
  const name = `${pgEnv.PGDATABASE}_${stamp()}.dump`
  const outFile = path.join(BACKUP_DIR, name)

  // 一時ファイルへ出力し、成功時のみ本ファイルへ移動する。
  // (直接書くと失敗時に空/壊れたdumpが残り、後のrestoreで事故になるため)
  const tmpFile = `${outFile}.tmp`
  rmSync(tmpFile, { force: true })

  try {
    if (hasLocalPgClient()) {
      runPg('pg_dump', ['-Fc', '-f', tmpFile], { pgEnv })
    } else {
      // コンテナ内のパスへは書けないので、標準出力をホスト側の一時ファイルへ受ける
      const fd = openSync(tmpFile, 'w')
      try {
        runPg('pg_dump', ['-Fc'], { pgEnv, stdio: ['ignore', fd, 'inherit'] })
      } finally {
        closeSync(fd)
      }
    }
    renameSync(tmpFile, outFile)
  } catch (err) {
    rmSync(tmpFile, { force: true })
    throw err
  }

  console.log(`Backup created: backup/${name}`)
}

main()
