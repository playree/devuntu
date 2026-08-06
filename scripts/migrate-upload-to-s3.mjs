/**
 * ローカルの `upload/` 配下のファイルをオブジェクトストレージへ移行する一度きりのスクリプト。
 *
 *   pnpm upload:migrate
 *
 * DBは触らない。`link_widget.iconPath` は `/api/upload/<ファイル名>` 形式で、
 * ファイル名をそのままオブジェクトキーにするためURLが変わらず、DBの書き換えが不要。
 * 移行したファイルは Attachment レコードを持たないが、配信側
 * (`src/app/api/upload/[filename]/route.ts`)がストレージのContent-Typeに
 * フォールバックするためそのまま参照できる。
 *
 * アプリのモジュール(`@/` エイリアス)を読めないため、S3クライアントはここで組み立てる。
 * 設定値は `src/lib/env-util.ts` の同名の環境変数と揃えている。
 */
import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const UPLOAD_DIR = path.join(process.cwd(), 'upload')
const BUCKET = process.env.S3_BUCKET || 'devuntu'

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

/** 既にアップロード済みかを判定する(何度実行しても安全にするため) */
const exists = async (key) => {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

const main = async () => {
  if (!process.env.S3_ENDPOINT) {
    throw new Error('S3_ENDPOINT is not set')
  }
  await ensureBucket()

  const entries = await readdir(UPLOAD_DIR, { withFileTypes: true }).catch(() => [])
  // `.gitkeep` などのドットファイルは対象外
  const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name)
  if (!files.length) {
    console.log('no files to migrate')
    return
  }

  let migrated = 0
  let skipped = 0
  for (const name of files) {
    const contentType = CONTENT_TYPES[path.extname(name).toLowerCase()]
    if (!contentType) {
      console.warn(`skip (unknown extension): ${name}`)
      skipped++
      continue
    }
    if (await exists(name)) {
      console.log(`skip (already exists): ${name}`)
      skipped++
      continue
    }
    const body = await readFile(path.join(UPLOAD_DIR, name))
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: name,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    )
    console.log(`migrated: ${name} (${body.byteLength} bytes)`)
    migrated++
  }
  console.log(`done. migrated=${migrated} skipped=${skipped}`)
}

await main()
