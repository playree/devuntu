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
import { setTimeout as sleep } from 'node:timers/promises'
import { runScript } from './run-script.mjs'

/**
 * メンテナンスON後、アプリが接続を解放するまでの待ち。
 *
 * アプリ側の監視(`src/lib/maintenance/maintenance-mode.ts` の `MAINTENANCE_MODE_WATCH_MS`)は
 * 5秒間隔なので、取りこぼさないよう2周ぶん待つ。ここで待たないと `restore-db.mjs` の
 * 接続チェックにアイドル接続が引っかかる。
 */
const DRAIN_MS = 10_000

const usage = () => {
  console.error('Usage: node ./scripts/restore-all.mjs <backup-dir> [--force] [--file <maintenance-flag>]')
  console.error('Example: node ./scripts/restore-all.mjs backup/full_20260921_120000')
}

/**
 * 中身を先に検証する。
 *
 * `restore-db.mjs` は `DROP DATABASE` から始めるため、S3 側の不備で後半だけ失敗すると
 * 「DBは作り直したのに画像は戻っていない」状態になる。破壊的操作の前に対が揃っているか確かめる。
 */
const resolveBackup = (backupDir) => {
  if (!existsSync(backupDir)) {
    console.error(`Directory not found: ${backupDir}`)
    process.exit(1)
  }

  const dumps = readdirSync(backupDir).filter((name) => name.endsWith('.dump'))
  if (dumps.length !== 1) {
    console.error(`Invalid backup (直下の *.dump が ${dumps.length} 件): ${backupDir}`)
    usage()
    process.exit(1)
  }

  const s3Dir = path.join(backupDir, 's3')
  if (!existsSync(path.join(s3Dir, 'manifest.json'))) {
    console.error(`Invalid backup (s3/manifest.json がありません): ${backupDir}`)
    usage()
    process.exit(1)
  }

  return { dumpFile: path.join(backupDir, dumps[0]), s3Dir }
}

const main = async () => {
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

  const onCode = runScript('maintenance.mjs', ['on', ...fileArgs])
  if (onCode !== 0) {
    console.error(`メンテナンスモードにできなかったため中断しました (exit ${onCode})`)
    process.exit(onCode)
  }

  console.log(`アプリが接続を解放するまで ${DRAIN_MS / 1000} 秒待ちます...`)
  await sleep(DRAIN_MS)

  const steps = [
    ['restore-db.mjs', [dumpFile, ...(force ? ['--force'] : [])]],
    ['restore-s3.mjs', [s3Dir]],
  ]

  for (const [script, stepArgs] of steps) {
    const code = runScript(script, stepArgs)
    if (code !== 0) {
      console.error(`${script} が失敗したため中断しました (exit ${code})`)
      console.error('メンテナンスモードは ON のままです。原因を直してからやり直してください。')
      process.exit(code)
    }
  }

  console.log('Restore completed.')
  console.log('メンテナンスモードは ON のままです。表示を確認してから解除してください:')
  console.log('  pnpm maintenance off')
  console.log('  docker compose run --rm tools maintenance off')
}

await main()
