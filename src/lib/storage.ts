import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { envu } from './env-util'
import { logger } from './logger'

/**
 * オブジェクトストレージ(S3互換)へのアクセス層。
 *
 * `@aws-sdk/client-s3` への依存はこのファイルに閉じ込め、呼び出し側は
 * キーとバイト列だけを扱う。接続先は `S3_ENDPOINT` で切り替えられるため、
 * SeaweedFS 以外の S3 互換ストレージでもそのまま動く。
 */

/**
 * S3クライアント。
 *
 * 環境変数の必須チェックがビルド時に走らないよう、初回利用時まで生成を遅延する。
 * Dockerfile の `pnpm build` には S3 系の環境変数を渡していないため、
 * モジュール読み込み時に `envu.server.S3_ENDPOINT` を評価してはいけない。
 */
let client: S3Client | undefined
const getClient = () => {
  if (!client) {
    client = new S3Client({
      endpoint: envu.server.S3_ENDPOINT,
      region: envu.server.S3_REGION,
      // SeaweedFS はバーチャルホスト形式のアドレッシングに対応しないためパススタイルで送る
      forcePathStyle: envu.server.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: envu.server.S3_ACCESS_KEY_ID,
        secretAccessKey: envu.server.S3_SECRET_ACCESS_KEY,
      },
    })
  }
  return client
}

/** S3のエラーコードを判定する(SDKはエラーの型を絞ってくれないため名前で見る) */
const isErrorCode = (err: unknown, ...codes: string[]) => {
  if (err instanceof S3ServiceException) {
    return codes.includes(err.name)
  }
  return false
}

/**
 * バケットを作成する。既に存在する場合は何もしない。
 * SeaweedFS はバケットを自動作成しないため、初回書き込み時にここを通す。
 */
const ensureBucket = async () => {
  const Bucket = envu.server.S3_BUCKET
  try {
    await getClient().send(new CreateBucketCommand({ Bucket }))
    logger.info({ Bucket }, 'bucket created')
  } catch (err) {
    if (isErrorCode(err, 'BucketAlreadyOwnedByYou', 'BucketAlreadyExists')) {
      return
    }
    throw err
  }
}

/**
 * オブジェクトを保存する。
 * バケット未作成の場合は作成してから1度だけリトライする。
 */
export const putObject = async (key: string, body: Uint8Array, contentType: string) => {
  const command = () =>
    new PutObjectCommand({
      Bucket: envu.server.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    })
  try {
    await getClient().send(command())
  } catch (err) {
    if (!isErrorCode(err, 'NoSuchBucket')) {
      throw err
    }
    await ensureBucket()
    await getClient().send(command())
  }
  logger.debug({ key, contentType, size: body.byteLength }, 'object put')
}

/**
 * オブジェクトを取得する。存在しない場合は `null` を返す。
 *
 * 本文はメモリに載せずWebストリームのまま返し、Route Handler の
 * レスポンスへそのまま流す。
 */
export const getObject = async (key: string) => {
  try {
    const res = await getClient().send(
      new GetObjectCommand({
        Bucket: envu.server.S3_BUCKET,
        Key: key,
      }),
    )
    if (!res.Body) {
      return null
    }
    return {
      body: res.Body.transformToWebStream(),
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    }
  } catch (err) {
    if (isErrorCode(err, 'NoSuchKey', 'NotFound', 'NoSuchBucket')) {
      return null
    }
    throw err
  }
}

/**
 * オブジェクトを削除する。存在しないキーの削除はS3の仕様上エラーにならない。
 */
export const deleteObject = async (key: string) => {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: envu.server.S3_BUCKET,
      Key: key,
    }),
  )
  logger.debug({ key }, 'object deleted')
}
