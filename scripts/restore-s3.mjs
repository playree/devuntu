/**
 * `backup-s3.mjs` が出力したバックアップをオブジェクトストレージへ復元する。
 *
 *   pnpm s3:restore backup/s3_YYYYMMDD_HHMMSS
 *
 * Docker環境では使い捨てコンテナで実行する(手順はREADME参照)。
 *
 * バックアップに含まれるキーを上書きするだけで、ストレージ側にしか無いオブジェクトは
 * 削除しない。DBリストア(`restore-db.sh`)がDBを作り直すのと挙動が異なる。
 * 画像の実体を消して復旧不能にするより、余分が残る方が安全なため。
 *
 * アプリのモジュール(`@/` エイリアス)を読めないため、S3クライアントはここで組み立てる。
 * 設定値は `src/lib/env-util.ts` の同名の環境変数と揃えている。
 * このファイル単体をマウントするだけでも実行できるよう、
 * `backup-s3.mjs` と共通処理を切り出さず、それぞれ自己完結させている。
 */
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

const BUCKET = process.env.S3_BUCKET || 'devuntu'

/** manifest に Content-Type が無い場合のフォールバック(移行スクリプトと同じ対応表) */
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
  console.error('Usage: node ./scripts/restore-s3.mjs <backup-dir>')
  console.error('Example: node ./scripts/restore-s3.mjs backup/s3_20260807_120000')
}

const main = async () => {
  const backupDir = process.argv[2]
  if (!backupDir) {
    usage()
    process.exit(1)
  }
  if (!process.env.S3_ENDPOINT) {
    throw new Error('S3_ENDPOINT is not set')
  }

  const manifestPath = path.join(backupDir, 'manifest.json')
  const manifest = await readFile(manifestPath, 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)
  if (!manifest?.objects) {
    console.error(`Invalid backup (manifest.json not found or broken): ${manifestPath}`)
    usage()
    process.exit(1)
  }

  console.log(`Restoring ${manifest.objects.length} objects from ${backupDir} into ${BUCKET}...`)
  await ensureBucket()

  let restored = 0
  let failed = 0
  for (const obj of manifest.objects) {
    const contentType = obj.contentType || CONTENT_TYPES[path.extname(obj.key).toLowerCase()]
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
      console.log(`restored: ${obj.key} (${body.byteLength} bytes)`)
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
