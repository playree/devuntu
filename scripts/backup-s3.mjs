/**
 * オブジェクトストレージ(S3互換)の中身をローカルへバックアップする。
 *
 *   pnpm s3:backup
 *
 * Docker環境では使い捨てコンテナで実行する(手順はREADME参照)。
 *
 * S3 API 経由の論理バックアップにしているのは、無停止で取得でき、
 * SeaweedFS の内部レイアウトに依存せず他の S3 互換ストレージへも復元できるため。
 *
 * アプリのモジュール(`@/` エイリアス)を読めないため、S3クライアントはここで組み立てる。
 * 設定値は `src/lib/env-util.ts` の同名の環境変数と揃えている。
 * このファイル単体をマウントするだけでも実行できるよう、
 * `restore-s3.mjs` と共通処理を切り出さず、それぞれ自己完結させている。
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * ローカル実行では `.env` を読む。
 * Dockerコンテナでは env_file で環境変数が渡され、standaloneビルドに dotenv が
 * 同梱されないため、解決できなくても続行する。
 */
await import('dotenv/config').catch(() => {})

const BACKUP_DIR = path.join(process.cwd(), 'backup')
const BUCKET = process.env.S3_BUCKET || 'devuntu'

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.toLowerCase() !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
})

/** `backup-db.sh` と揃えた `YYYYMMDD_HHMMSS`(ローカル時刻) */
const stamp = () => {
  const d = new Date()
  const p = (n, len = 2) => String(n).padStart(len, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * アップロードのキーは `<uuidv7>.<拡張子>` のフラット構成(`src/lib/upload.ts`)。
 * ディレクトリ区切りを含むキーはそのままファイル名にすると出力先の外へ書けてしまうため、
 * ホワイトリストではなく構造で弾く。
 */
const isSafeKey = (key) => key.length > 0 && !key.includes('/') && !key.includes('\\') && key !== '.' && key !== '..'

/** バケット内の全オブジェクトを列挙する(1000件を超えても取りこぼさないようページングする) */
const listAll = async () => {
  const objects = []
  let ContinuationToken
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken }))
    objects.push(...(res.Contents || []))
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)
  return objects
}

const main = async () => {
  if (!process.env.S3_ENDPOINT) {
    throw new Error('S3_ENDPOINT is not set')
  }

  const name = `s3_${stamp()}`
  const outDir = path.join(BACKUP_DIR, name)
  // 一時ディレクトリへ書き、成功時のみ本ディレクトリへ移動する。
  // (途中で失敗したものを残すと、後のrestoreで欠けたまま復元してしまうため)
  const tmpDir = `${outDir}.tmp`
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(path.join(tmpDir, 'objects'), { recursive: true })

  try {
    const contents = await listAll()
    const objects = []
    let skipped = 0
    let totalBytes = 0

    for (const item of contents) {
      const key = item.Key
      if (!isSafeKey(key)) {
        console.warn(`skip (unsafe key): ${key}`)
        skipped++
        continue
      }
      const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
      await pipeline(res.Body, createWriteStream(path.join(tmpDir, 'objects', key)))
      objects.push({
        key,
        contentType: res.ContentType,
        size: res.ContentLength ?? item.Size,
        etag: item.ETag,
        lastModified: item.LastModified?.toISOString(),
      })
      totalBytes += res.ContentLength ?? item.Size ?? 0
      console.log(`saved: ${key} (${res.ContentLength ?? item.Size} bytes)`)
    }

    /**
     * Content-Type を控えるのは、復元後も配信側
     * (`src/app/api/upload/[filename]/route.ts`)のストレージ側フォールバックが
     * 正しい型を返せるようにするため。
     */
    const manifest = {
      createdAt: new Date().toISOString(),
      endpoint: process.env.S3_ENDPOINT,
      bucket: BUCKET,
      objects,
    }
    await writeFile(path.join(tmpDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    await rm(outDir, { recursive: true, force: true })
    await rename(tmpDir, outDir)

    console.log(`Backup created: backup/${name} (${objects.length} objects, ${totalBytes} bytes, skipped=${skipped})`)
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    throw err
  }
}

await main()
