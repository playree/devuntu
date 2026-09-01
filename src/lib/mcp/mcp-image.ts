/**
 * 画像の添付・取得のための MCP ツール(サーバー専用)
 *
 * 本文(チケット/コメント)へ画像を貼るには、まず画像を保存して `/api/upload/<キー>` を得てから、
 * その URL を Markdown 記法で `content` へ書く。ここではその「保存」と「読み取り」だけを担い、
 * 本文の更新は既存のチケット系ツールに任せる。
 *
 * 保存の経路は 2 つある。ファイルを直接 POST させる短命トークン方式が主で、base64 を引数で渡す
 * 方式はシェルを実行できないクライアント向けの退避手段。base64 はモデルが文字列として生成する
 * ことになりコンテキストを激しく消費するため、ツールの説明でも直接 POST へ誘導している。
 */

import { LocaleItem } from '@/locale'
import { t } from '@/locale/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { assertBoardAccess, assertTicketAccess, getBoardAccess } from '../board/board'
import { errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import type { ResourceAuth } from '../oauth/oauth-resource'
import { prisma } from '../prisma'
import { assertRateLimit } from '../rate-limit'
import { ACCEPTED_IMAGE_TYPES, zImageFile } from '../schema/schema'
import { makeUrl } from '../server-utils'
import { saveContentImage } from '../storage/attachment'
import { resizeWebp, WEBP_MIME } from '../storage/image'
import { getObject } from '../storage/storage'
import { isValidUploadKey, toUploadKey, UPLOAD_URL_PREFIX } from '../storage/upload'
import { signUploadToken, UPLOAD_TOKEN_TTL_SECONDS } from '../storage/upload-token'
import { resolveTicketId } from './mcp-ticket'

/**
 * base64 で受け取れる文字列長の上限。
 *
 * デコード後は `zImageFile` の 5MB がさらに効くが、ここはモデルが生成する文字列量そのものの
 * 歯止めなので、はるかに手前で切ってデコード前に弾く。
 */
const MAX_BASE64_LENGTH = 512 * 1024

/** 読み取りで返す画像の長辺。Claude 側で 1568px を超える画像は縮小されるのでそれ以上は無駄になる */
const DEFAULT_READ_SIZE = 1024
const MIN_READ_SIZE = 256
const MAX_READ_SIZE = 1568

/** 縮小してもなお大きい場合の再縮小のしきい値と長辺(多フレームの webp が該当しうる) */
const READ_FALLBACK_THRESHOLD = 1_500_000
const READ_FALLBACK_SIZE = 512

const UPLOAD_TOKEN_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 }
/** sharp の変換で CPU を使うため、読み取りは書き込みより短い窓で絞る */
const READ_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 }

const jsonResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

/** 添付先ボードの指定。新規作成前は ticketId が無いので boardId も受ける */
const targetSchema = {
  ticketId: z
    .string()
    .min(1)
    .optional()
    .describe('添付先チケットの表示ID(例: ABC-42)またはチケットID。boardId とはどちらか一方を指定する'),
  boardId: z.uuidv7().optional().describe('添付先ボードのID。これから作成するチケット向け。ticketId とは排他'),
}

/**
 * 添付先ボードを決める。
 *
 * 画像は本文へ貼る前提なので、チケット指定の場合は閲覧ではなく編集できることを要求する。
 * ボードに属さない添付(全ログインユーザーが読める)は MCP からは作らせない。
 */
const resolveUploadTarget = async (
  auth: ResourceAuth,
  { ticketId, boardId }: { ticketId?: string; boardId?: string },
): Promise<string> => {
  if ((ticketId ? 1 : 0) + (boardId ? 1 : 0) !== 1) {
    throw errValidation('ticketId と boardId はどちらか一方を指定してください')
  }
  if (ticketId) {
    // 'edit' は canEdit(= メンバー かつ 未アーカイブ)なので、アーカイブ済みボードはここで弾かれる
    const access = await assertTicketAccess(auth.user, await resolveTicketId(auth, ticketId), 'edit')
    return access.boardId
  }
  const board = await assertBoardAccess(auth.user, boardId as string, 'view')
  if (board.archived) {
    throw errInvalidOperation()
  }
  return board.boardId
}

/** `data:image/png;base64,...` 形式で渡されることが多いので接頭辞を許容する */
const stripDataUrl = (data: string) => data.replace(/^data:[^;,]*;base64,/, '').trim()

/** 保存済み画像の指定は key でも `/api/upload/<key>` URL でも受ける(絶対URLも可) */
const parseImageKey = (image: string): string => {
  const key = toUploadKey(image.trim())
  if (!isValidUploadKey(key)) {
    throw errInvalidOperation()
  }
  return key
}

const uploadImageForMcp = async (
  auth: ResourceAuth,
  input: { ticketId?: string; boardId?: string; filename: string; mimeType: string; data: string },
) => {
  const boardId = await resolveUploadTarget(auth, input)
  assertRateLimit(`upload-image:${auth.user.id}`, UPLOAD_TOKEN_RATE_LIMIT)

  const bytes = Buffer.from(stripDataUrl(input.data), 'base64')
  const file = new File([new Uint8Array(bytes)], input.filename, { type: input.mimeType })
  const parsed = zImageFile.safeParse(file)
  if (!parsed.success) {
    throw errValidation(t(null, (parsed.error.issues[0]?.message ?? '@invalid_image_type') as LocaleItem))
  }

  const { url } = await saveContentImage(parsed.data, { boardId, userId: auth.user.id })
  logger.info({ userId: auth.user.id, boardId }, 'mcp image uploaded')
  return { url, markdown: `![${input.filename}](${url})` }
}

const createImageUploadTokenForMcp = async (auth: ResourceAuth, input: { ticketId?: string; boardId?: string }) => {
  const boardId = await resolveUploadTarget(auth, input)
  assertRateLimit(`upload-token:user:${auth.user.id}`, UPLOAD_TOKEN_RATE_LIMIT)

  const token = await signUploadToken({ userId: auth.user.id, boardId })
  const uploadUrl = makeUrl(UPLOAD_URL_PREFIX).toString()
  logger.info({ userId: auth.user.id, boardId }, 'mcp upload token issued')

  return {
    uploadUrl,
    token,
    expiresIn: UPLOAD_TOKEN_TTL_SECONDS,
    boardId,
    curl: `curl -sS -X POST ${uploadUrl} -H "Authorization: Bearer ${token}" -F "file=@<画像ファイルのパス>"`,
    note:
      `上記のコマンドを実行すると {"url":"${UPLOAD_URL_PREFIX}/<キー>.webp"} が返る。` +
      'その url を `![説明](url)` の形で本文(content)に書くと画像として表示される。' +
      'トークンは1回限りの使い捨てで、添付先ボードは発行時に固定されている。',
  }
}

const getImageForMcp = async (auth: ResourceAuth, input: { image: string; maxSize?: number }) => {
  assertRateLimit(`get-image:${auth.user.id}`, READ_RATE_LIMIT)
  const key = parseImageKey(input.image)

  const attachment = await prisma.attachment.findUnique({
    where: { key },
    select: { boardId: true, originalName: true, size: true },
  })
  // アクセス不可は未存在と区別せず、キーの当たり判定を返さない(配信APIと同じ扱い)
  if (!attachment || (attachment.boardId && !(await getBoardAccess(auth.user, attachment.boardId)))) {
    throw errInvalidOperation()
  }

  const object = await getObject(key)
  if (!object) {
    throw errInvalidOperation()
  }

  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
  const size = input.maxSize ?? DEFAULT_READ_SIZE
  let webp = await resizeWebp(bytes, size)
  if (webp.byteLength > READ_FALLBACK_THRESHOLD && size > READ_FALLBACK_SIZE) {
    webp = await resizeWebp(bytes, READ_FALLBACK_SIZE)
  }

  return {
    image: { data: webp.toString('base64'), mimeType: WEBP_MIME },
    meta: { key, originalName: attachment.originalName, storedSize: attachment.size, returnedSize: webp.byteLength },
  }
}

/**
 * 画像ツールを登録する。接続の種類(人間 / AIエージェント)は問わない。
 */
export const registerImageTools = (server: McpServer, auth: ResourceAuth) => {
  server.registerTool(
    'create_image_upload_token',
    {
      title: '画像アップロード用トークン発行',
      description:
        'チケット本文やコメントへ画像を貼るための、使い捨てのアップロードURLとトークンを発行する。' +
        `返された curl コマンドで画像ファイルを直接POSTすると \`${UPLOAD_URL_PREFIX}/<キー>.webp\` が返るので、` +
        'その URL を `![説明](URL)` の Markdown 記法で本文(content)に埋め込む(生の <img> タグは表示時に除去される)。' +
        'ローカルにファイルがある場合は必ずこちらを使うこと(upload_image は大量のトークンを消費する)。' +
        `有効期限は${UPLOAD_TOKEN_TTL_SECONDS / 60}分で1回だけ使える`,
      inputSchema: targetSchema,
    },
    async (input) => jsonResult(await createImageUploadTokenForMcp(auth, input)),
  )

  server.registerTool(
    'upload_image',
    {
      title: '画像アップロード(base64)',
      description:
        '画像の base64 を直接渡してアップロードし、本文へ貼るための URL を返す。' +
        'シェルを実行できないクライアント専用の退避手段で、base64 はコンテキストを大量に消費するため、' +
        'ファイルのパスが分かる場合は create_image_upload_token を使うこと。' +
        `data は ${Math.floor(MAX_BASE64_LENGTH / 1024)}KB(目安として100KB以下の画像)まで`,
      inputSchema: {
        ...targetSchema,
        filename: z.string().min(1).max(255).describe('元のファイル名。画像の alt にも使う'),
        mimeType: z.enum(ACCEPTED_IMAGE_TYPES),
        data: z
          .string()
          .min(1)
          .max(MAX_BASE64_LENGTH)
          .describe('画像の base64。`data:image/png;base64,` の接頭辞は付いていてもよい'),
      },
    },
    async (input) => jsonResult(await uploadImageForMcp(auth, input)),
  )

  server.registerTool(
    'get_image',
    {
      title: '画像取得',
      description:
        `チケット本文やコメントに貼られた画像(\`${UPLOAD_URL_PREFIX}/<キー>\` の URL、またはキー)を取得して画像として返す。` +
        '本文のスクリーンショットや図を実際に見たいときに使う',
      inputSchema: {
        image: z.string().min(1).describe(`\`${UPLOAD_URL_PREFIX}/<キー>.webp\` の URL、またはキーそのもの`),
        maxSize: z
          .number()
          .int()
          .min(MIN_READ_SIZE)
          .max(MAX_READ_SIZE)
          .optional()
          .describe(`返す画像の長辺(px)。既定 ${DEFAULT_READ_SIZE}`),
      },
    },
    async (input) => {
      const { image, meta } = await getImageForMcp(auth, input)
      return {
        content: [
          { type: 'image' as const, data: image.data, mimeType: image.mimeType },
          { type: 'text' as const, text: JSON.stringify(meta, null, 2) },
        ],
      }
    },
  )
}
