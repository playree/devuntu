/**
 * `backup-s3.mjs` が出力したバックアップをオブジェクトストレージへ復元する。
 *
 *   pnpm s3:restore backup/s3_YYYYMMDD_HHMMSS
 *
 * Docker環境では compose.yaml の tools サービスで実行する(手順は docs/operations.md 参照)。
 *
 * `--check` を付けると、ストレージへ一切接続せずバックアップの中身だけを検証して終わる。
 * `restore-all.mjs` が `restore-db.mjs`(DROP DATABASE から始まる)より**前**に呼ぶためのもので、
 * S3 側の不備で後半だけ失敗し「DBは作り直したのに画像は戻っていない」状態になるのを防ぐ。
 *
 * バックアップに含まれるキーを上書きするだけで、ストレージ側にしか無いオブジェクトは
 * 削除しない。DBリストア(`restore-db.mjs`)がDBを作り直すのと挙動が異なる。
 * 画像の実体を消して復旧不能にするより、余分が残る方が安全なため。
 *
 * アプリのモジュール(`@/` エイリアス)を読めないため、S3クライアントはここで組み立てる。
 * 設定値は `src/lib/env-util.ts` の同名の環境変数と揃えている。
 * このファイル単体をマウントするだけでも実行できるよう、
 * `backup-s3.mjs` と共通処理を切り出さず、それぞれ自己完結させている。
 */
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

const BUCKET = process.env.S3_BUCKET || 'devuntu'

/** manifest に Content-Type が無い場合のフォールバック */
const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.toLowerCase() !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
})

const ensureBucket = async () => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }))
    console.log(`bucket created: ${BUCKET}`)
  } catch (err) {
    if (err?.name === 'BucketAlreadyOwnedByYou' || err?.name === 'BucketAlreadyExists') {
      return
    }
    throw err
  }
}

const usage = () => {
  console.error('Usage: node ./scripts/restore-s3.mjs <backup-dir> [--check]')
  console.error('Example: node ./scripts/restore-s3.mjs backup/s3_20260807_120000')
}

/** manifest の Content-Type、無ければ拡張子からの補完。復元時に使うものと同じ解決 */
const resolveContentType = (obj) => obj.contentType || CONTENT_TYPES[path.extname(obj.key ?? '').toLowerCase()]

/**
 * 復元せずにバックアップの中身だけを確かめる。
 *
 * 見るのは「復元ループで失敗しうる条件」と同じもの(キーの実体が無い / Content-Type が決まらない)。
 * ここを通れば、あとはストレージ側の問題以外では落ちない。
 */
const checkBackup = (backupDir, manifest) => {
  const issues = []
  for (const obj of manifest.objects) {
    if (!obj?.key || typeof obj.key !== 'string') {
      issues.push(`key を持たない要素があります: ${JSON.stringify(obj)}`)
      continue
    }
    if (!existsSync(path.join(backupDir, 'objects', obj.key))) {
      issues.push(`objects/${obj.key} がありません`)
      continue
    }
    if (!resolveContentType(obj)) {
      issues.push(`${obj.key} の Content-Type を決められません`)
    }
  }

  if (issues.length > 0) {
    console.error(`Invalid backup (${issues.length} 件): ${backupDir}`)
    for (const issue of issues) {
      console.error(`  - ${issue}`)
    }
    process.exit(1)
  }
  console.log(`Backup looks valid: ${backupDir} (${manifest.objects.length} objects)`)
}

const main = async () => {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const backupDir = args.find((arg) => !arg.startsWith('--'))
  if (!backupDir) {
    usage()
    process.exit(1)
  }
  // --check はストレージへ触らないので、S3 の設定が無くても実行できる
  if (!check && !process.env.S3_ENDPOINT) {
    throw new Error('S3_ENDPOINT is not set')
  }

  const manifestPath = path.join(backupDir, 'manifest.json')
  const manifest = await readFile(manifestPath, 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)
  if (!Array.isArray(manifest?.objects)) {
    console.error(`Invalid backup (manifest.json not found or broken): ${manifestPath}`)
    usage()
    process.exit(1)
  }

  if (check) {
    checkBackup(backupDir, manifest)
    return
  }

  console.log(`Restoring ${manifest.objects.length} objects from ${backupDir} into ${BUCKET}...`)
  await ensureBucket()

  let restored = 0
  let failed = 0
  for (const obj of manifest.objects) {
    const contentType = resolveContentType(obj)
    if (!contentType) {
      console.warn(`skip (unknown content type): ${obj.key}`)
      failed++
      continue
    }
    try {
      const body = await readFile(path.join(backupDir, 'objects', obj.key))
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: obj.key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.byteLength,
        }),
      )
      restored++
    } catch (err) {
      console.error(`failed: ${obj.key} (${err?.message})`)
      failed++
    }
  }

  console.log(`done. restored=${restored} failed=${failed}`)
  if (failed > 0) {
    process.exit(1)
  }
}

await main()
