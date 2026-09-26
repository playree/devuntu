/**
 * PostgreSQL の中身をローカルへバックアップする。
 *
 *   pnpm db:backup
 *
 * Docker環境では compose.yaml の tools サービスで実行する(手順は docs/operations.md 参照)。
 *
 *   docker compose run --rm tools db-backup
 *
 * `--out <file>` で出力先を指定できる(`backup-all.mjs` から対のディレクトリへ書かせるため)。
 * 引数なしの場合は従来どおり `backup/<DB名>_<stamp>.dump` へ出力する。
 *
 * 接続先は `DATABASE_URL`、実行経路の切り替えは `db-connect.mjs` を参照。
 */
import { closeSync, mkdirSync, openSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { hasLocalPgClient, resolveDbEnv, runPg, showTransport, stamp } from './db-connect.mjs'
import { matchOwner } from './file-owner.mjs'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

const BACKUP_DIR = path.join(process.cwd(), 'backup')

/** `--out <file>` の値。無ければ undefined */
const parseOut = (args) => {
  const index = args.indexOf('--out')
  if (index < 0) {
    return undefined
  }
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    console.error('--out には出力先のファイルパスを指定してください')
    process.exit(1)
  }
  return value
}

const main = () => {
  const out = parseOut(process.argv.slice(2))

  const pgEnv = resolveDbEnv(process.env.DATABASE_URL)
  showTransport()

  const outFile = out ? path.resolve(out) : path.join(BACKUP_DIR, `${pgEnv.PGDATABASE}_${stamp()}.dump`)
  mkdirSync(path.dirname(outFile), { recursive: true })

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
    matchOwner([path.dirname(outFile), outFile])
  } catch (err) {
    rmSync(tmpFile, { force: true })
    throw err
  }

  console.log(`Backup created: ${path.relative(process.cwd(), outFile) || outFile}`)
}

main()
