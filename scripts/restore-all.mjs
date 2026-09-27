/**
 * `backup-all.mjs` が出力したディレクトリから、DB と オブジェクトストレージをまとめて復元する。
 *
 *   pnpm full:restore backup/full_YYYYMMDD_HHMMSS
 *   docker compose run --rm tools full-restore backup/full_YYYYMMDD_HHMMSS
 *
 * 開始時にメンテナンスモードを ON にするので、`docker compose stop devuntu` は要らない。
 * **完了しても ON のまま**にしてある。戻ったデータを確認してから手で解除する。
 *
 * DB が失敗したら S3 へは進まない(DB を戻せていない状態で画像だけ上書きしても意味がなく、
 * やり直しの前提も変わってしまうため)。
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { t } from './messages.mjs'
import { runScript } from './run-script.mjs'

/**
 * ローカル実行では `.env` を読む(表示言語の `DEFAULT_LOCALE` を子のスクリプトと揃えるため)。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

/**
 * メンテナンスON後、アプリが接続を解放するまで待つ上限(秒)。
 *
 * 固定時間の見切り発車にはしない。アプリは遮断に気づいても**実行中のワーカーが終わるまで**
 * 接続を手放さない(`src/lib/maintenance/maintenance-mode.ts`)ので、
 * `restore-db.mjs` の `--wait` で**接続数が 0 になったこと**を確かめれば、
 * ログ・生存申告・終了状態の書き込みまで済んだことになる。
 * 上限まで残っていれば復元は始まらず中断するので、長い処理を抱えたまま DROP することはない。
 */
const DRAIN_WAIT_SEC = 60

const usage = () => {
  console.error(t('restore_all_usage'))
}

/**
 * 中身を先に検証する。
 *
 * `restore-db.mjs` は `DROP DATABASE` から始めるため、S3 側の不備で後半だけ失敗すると
 * 「DBは作り直したのに画像は戻っていない」状態になる。破壊的操作の前に対が揃っているか確かめる。
 */
const resolveBackup = (backupDir) => {
  if (!existsSync(backupDir)) {
    console.error(t('dir_not_found', backupDir))
    process.exit(1)
  }

  const dumps = readdirSync(backupDir).filter((name) => name.endsWith('.dump'))
  if (dumps.length !== 1) {
    console.error(t('invalid_backup_dumps', dumps.length, backupDir))
    usage()
    process.exit(1)
  }

  const s3Dir = path.join(backupDir, 's3')
  if (!existsSync(path.join(s3Dir, 'manifest.json'))) {
    console.error(t('invalid_backup_no_manifest', backupDir))
    usage()
    process.exit(1)
  }

  return { dumpFile: path.join(backupDir, dumps[0]), s3Dir }
}

const main = () => {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const fileIndex = args.indexOf('--file')
  // メンテナンスフラグの置き場を変えている構成でも使えるよう、指定があれば maintenance.mjs へ渡す
  const fileArgs = fileIndex >= 0 ? ['--file', args[fileIndex + 1] ?? ''] : []
  // `--file` の値はオプションの一部なので、バックアップ先として拾わない
  const valueIndex = fileIndex >= 0 ? fileIndex + 1 : -1
  const backupDir = args.find((arg, index) => !arg.startsWith('--') && index !== valueIndex)

  if (!backupDir) {
    usage()
    process.exit(1)
  }

  const { dumpFile, s3Dir } = resolveBackup(backupDir)

  // S3 側は実体まで確かめる。`restore-db.mjs` は DROP DATABASE から始まるので、この後では遅い
  const checkCode = runScript('restore-s3.mjs', [s3Dir, '--check'])
  if (checkCode !== 0) {
    console.error(t('s3_check_failed'))
    process.exit(checkCode)
  }

  const onCode = runScript('maintenance.mjs', ['on', ...fileArgs])
  if (onCode !== 0) {
    console.error(t('maintenance_on_failed', onCode))
    process.exit(onCode)
  }

  const steps = [
    ['restore-db.mjs', [dumpFile, '--wait', String(DRAIN_WAIT_SEC), ...(force ? ['--force'] : [])]],
    ['restore-s3.mjs', [s3Dir]],
  ]

  for (const [script, stepArgs] of steps) {
    const code = runScript(script, stepArgs)
    if (code !== 0) {
      console.error(t('step_failed', script, code))
      console.error(t('maintenance_still_on_retry'))
      process.exit(code)
    }
  }

  console.log(t('restore_completed'))
  console.log(t('maintenance_still_on_done'))
}

main()
