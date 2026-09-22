/**
 * DB と オブジェクトストレージを1つのディレクトリへまとめてバックアップする。
 *
 *   pnpm full:backup
 *   docker compose run --rm tools full-backup
 *
 * 永続データは2箇所に分かれており、片方だけでは復元できない。個別のコマンドを続けて叩く運用では
 * 対の取り漏れが起き、出力も別タイムスタンプで散らばるため、対応付けをディレクトリで固定する。
 *
 *   backup/full_YYYYMMDD_HHMMSS/
 *   ├── <DB名>.dump
 *   └── s3/
 *       ├── manifest.json
 *       └── objects/
 *
 * 片方でも失敗したら一時ディレクトリごと捨てる(欠けた対を残すと、後のリストアで事故になる)。
 */
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { resolveDbEnv, stamp } from './db-connect.mjs'
import { runScript } from './run-script.mjs'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

const BACKUP_DIR = path.join(process.cwd(), 'backup')

const main = () => {
  // ディレクトリを作る前に解決する。`DATABASE_URL` が無い/壊れている場合に空の tmp を残さない
  const pgEnv = resolveDbEnv(process.env.DATABASE_URL)

  const name = `full_${stamp()}`
  const outDir = path.join(BACKUP_DIR, name)
  const tmpDir = `${outDir}.tmp`
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })

  // DB → S3 の順。取得の間に添付が追加された場合、S3 側にしか無い未参照オブジェクトが残るだけで済む
  const steps = [
    ['backup-db.mjs', ['--out', path.join(tmpDir, `${pgEnv.PGDATABASE}.dump`)]],
    ['backup-s3.mjs', ['--out', path.join(tmpDir, 's3')]],
  ]

  for (const [script, args] of steps) {
    const code = runScript(script, args)
    if (code !== 0) {
      rmSync(tmpDir, { recursive: true, force: true })
      console.error(`${script} が失敗したため中断しました (exit ${code})`)
      process.exit(code)
    }
  }

  rmSync(outDir, { recursive: true, force: true })
  renameSync(tmpDir, outDir)

  console.log(`Backup created: backup/${name}`)
  console.log(`復元は: pnpm full:restore backup/${name}`)
}

main()
