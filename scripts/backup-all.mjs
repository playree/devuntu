/**
 * DB と オブジェクトストレージを1つのディレクトリへまとめてバックアップする。
 *
 *   pnpm full:backup [--maintenance] [--file <maintenance-flag>]
 *   docker compose run --rm tools full-backup [--maintenance]
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
 *
 * `--maintenance` を付けると、取得の間だけメンテナンスモードにして DB と S3 のずれを無くす。
 * 終われば成否に関わらず OFF に戻す。ただし開始前から ON だった場合は、運用者が入れた遮断なので触らない。
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { resolveDbEnv, stamp, waitForNoOtherConnections } from './db-connect.mjs'
import { matchOwner } from './file-owner.mjs'
import { parseMaintenanceFile } from './maintenance-flag.mjs'
import { runScript, signalExitCode, spawnScript } from './run-script.mjs'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

const BACKUP_DIR = path.join(process.cwd(), 'backup')

/**
 * メンテナンスON後、アプリが接続を解放するまで待つ上限(秒)。`restore-all.mjs` と揃える。
 * 上限まで残っていれば取得せず中断する(整合性のために付けたオプションなので、ずれたものを黙って取らない)
 */
const DRAIN_WAIT_SEC = 60

/** 実行中の子プロセス。`--maintenance` で受けたシグナルの転送先 */
let activeChild = null

/** DB → S3 を取得し、終了コードを返す */
const backup = async (pgEnv) => {
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
    const { child, exited } = spawnScript(script, args)
    activeChild = child
    const code = await exited
    activeChild = null
    if (code !== 0) {
      rmSync(tmpDir, { recursive: true, force: true })
      console.error(`${script} が失敗したため中断しました (exit ${code})`)
      return code
    }
  }

  rmSync(outDir, { recursive: true, force: true })
  renameSync(tmpDir, outDir)
  matchOwner([BACKUP_DIR])
  matchOwner([outDir], { recursive: true })

  console.log(`Backup created: backup/${name}`)
  console.log(`復元は: pnpm full:restore backup/${name}`)
  return 0
}

/** アプリが接続を手放す(実行中のワーカーも終わる)のを待ってから取得する */
const drainThenBackup = async (pgEnv) => {
  const remaining = await waitForNoOtherConnections(pgEnv, DRAIN_WAIT_SEC)
  if (remaining > 0) {
    console.error(`${pgEnv.PGDATABASE} に他の接続が ${remaining} 件残っているため中断しました`)
    return 1
  }
  return backup(pgEnv)
}

/** メンテナンスモードにしてから取得し、OFF に戻す。終了コードを返す */
const backupInMaintenance = async (pgEnv, file) => {
  if (existsSync(file)) {
    console.log('メンテナンスモードは既に ON です。取得後も ON のままにします')
    return drainThenBackup(pgEnv)
  }

  let off = false
  const turnOff = () => {
    if (off) {
      return 0
    }
    off = true
    const code = runScript('maintenance.mjs', ['off', '--file', file])
    if (code !== 0) {
      console.error(`メンテナンスモードを解除できませんでした (exit ${code})。手で解除してください:`)
      console.error('  docker compose run --rm tools maintenance off')
    }
    return code
  }

  // Ctrl+C / 停止でも遮断したまま終わらないようにする。
  // 取得中なら子へ転送し、子が落ちて取得が失敗を返したあと通常の経路で解除する
  // (`docker compose stop` の SIGTERM は子まで届かないため、転送しないと猶予切れの SIGKILL で解除し損ねる)
  const onSignal = (signal) => {
    if (activeChild) {
      activeChild.kill(signal)
      return
    }
    turnOff()
    process.exit(signalExitCode(signal))
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  let code
  try {
    code = runScript('maintenance.mjs', ['on', '--file', file])
    if (code !== 0) {
      console.error(`メンテナンスモードにできなかったため中断しました (exit ${code})`)
    } else {
      code = await drainThenBackup(pgEnv)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    code = 1
  }

  // 取得が成功していても解除に失敗したら非0にし、遮断が残ったことを cron などに気づかせる
  const offCode = turnOff()
  return code !== 0 ? code : offCode
}

const main = async () => {
  const args = process.argv.slice(2)

  // ディレクトリを作る前に解決する。`DATABASE_URL` が無い/壊れている場合に空の tmp を残さない
  const pgEnv = resolveDbEnv(process.env.DATABASE_URL)

  if (!args.includes('--maintenance')) {
    return backup(pgEnv)
  }

  let file
  try {
    file = parseMaintenanceFile(args)
  } catch (err) {
    console.error(err.message)
    return 1
  }
  return backupInMaintenance(pgEnv, file)
}

process.exit(await main())
