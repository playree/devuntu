/**
 * ファイル添付・取得のための MCP ツール(サーバー専用)
 *
 * 画像(mcp-image.ts)と同じく、ここでは「保存」と「読み取り」だけを担い、本文へのリンクの記載は
 * 既存のチケット系ツールに任せる。ファイルは大きくなりうるので base64 の受け渡しは設けず、
 * アップロードもダウンロードも短命トークンで `/api/upload` を直接叩かせる。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { envu } from '../env-util'
import { errInvalidOperation } from '../error'
import { logger } from '../logger'
import type { ResourceAuth } from '../oauth/oauth-resource'
import { prisma } from '../prisma'
import { assertRateLimit } from '../rate-limit'
import { makeUrl } from '../server-utils'
import { canViewAttachment } from '../storage/attachment-access'
import { getObject } from '../storage/storage'
import { toUploadUrl, UPLOAD_KIND_PARAM, UPLOAD_URL_PREFIX } from '../storage/upload'
import { DOWNLOAD_TOKEN_TTL_SECONDS, signDownloadToken, UPLOAD_TOKEN_TTL_SECONDS } from '../storage/upload-token'
import { jsonResult, TOOL_ANNOTATIONS } from './mcp'
import { issueUploadToken, parseUploadKey, targetSchema } from './mcp-image'

/** 本文をそのままテキストで返すファイルの上限。超えるものはダウンロードさせる */
export const MAX_INLINE_TEXT_SIZE = 256 * 1024

const READ_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 }

/**
 * テキストとして返せる中身なら文字列にする。
 * 型の申告(HTML などは保存時に octet-stream へ落としている)ではなく、UTF-8 として読めて NUL を含まないかで見る
 */
export const decodeText = (bytes: Uint8Array): string | null => {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return text.includes('\0') ? null : text
}

const createFileUploadTokenForMcp = async (auth: ResourceAuth, input: { ticketId?: string; boardId?: string }) => {
  const { boardId, token } = await issueUploadToken(auth, input)
  const uploadUrl = makeUrl(`${UPLOAD_URL_PREFIX}?${UPLOAD_KIND_PARAM}=file`).toString()

  return {
    uploadUrl,
    token,
    expiresIn: UPLOAD_TOKEN_TTL_SECONDS,
    boardId,
    maxSizeMb: envu.server.ATTACHMENT_MAX_SIZE_MB,
    curl: `curl -sS -X POST "${uploadUrl}" -H "Authorization: Bearer ${token}" -F "file=@<path to file>"`,
    note:
      `Running the command above returns {"url":"${UPLOAD_URL_PREFIX}/<key>"}. ` +
      'Write that url as a Markdown link `[file name](url)` in the content to attach the file. ' +
      'The token is single-use, and the target board is fixed when it is issued.',
  }
}

const getFileForMcp = async (auth: ResourceAuth, input: { file: string }) => {
  assertRateLimit(`get-file:${auth.user.id}`, READ_RATE_LIMIT)
  const key = parseUploadKey(input.file)

  const attachment = await prisma.attachment.findUnique({
    where: { key },
    select: { boardId: true, wikiSpaceId: true, originalName: true, size: true, mimeType: true },
  })
  // アクセス不可は未存在と区別せず、キーの当たり判定を返さない(配信APIと同じ扱い)
  if (
    !attachment ||
    !(await canViewAttachment(auth.user, { key, boardId: attachment.boardId, wikiSpaceId: attachment.wikiSpaceId }))
  ) {
    throw errInvalidOperation()
  }
  const meta = { key, name: attachment.originalName, size: attachment.size, mimeType: attachment.mimeType }

  if (attachment.size <= MAX_INLINE_TEXT_SIZE) {
    const object = await getObject(key)
    if (!object) {
      throw errInvalidOperation()
    }
    const text = decodeText(new Uint8Array(await new Response(object.body).arrayBuffer()))
    if (text !== null) {
      return { ...meta, text }
    }
  }

  const token = await signDownloadToken({ userId: auth.user.id, key })
  const downloadUrl = makeUrl(toUploadUrl(key)).toString()
  logger.info({ userId: auth.user.id, key }, 'mcp file download token issued')
  return {
    ...meta,
    downloadUrl,
    token,
    expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS,
    curl: `curl -sS -o <path to save> ${downloadUrl} -H "Authorization: Bearer ${token}"`,
    note:
      'The file is binary or too large to return as text. Download it with the curl command above. ' +
      'The token is valid only for this file and can be reused until it expires.',
  }
}

/**
 * ファイルツールを登録する。接続の種類(人間 / AIエージェント)は問わない。
 */
export const registerFileTools = (server: McpServer, auth: ResourceAuth) => {
  server.registerTool(
    'create_file_upload_token',
    {
      title: 'Create file upload token',
      annotations: TOOL_ANNOTATIONS.additive,
      description:
        'Issues a single-use upload URL and token for attaching a file (any type, such as logs, PDFs, or archives) to ticket content or comments. ' +
        `POST the file with the returned curl command to get \`${UPLOAD_URL_PREFIX}/<key>\`, ` +
        'then write that URL in the content as a Markdown link `[file name](URL)`. ' +
        'For images to display inline, use create_image_upload_token instead. ' +
        `Expires in ${UPLOAD_TOKEN_TTL_SECONDS / 60} minutes and can be used only once`,
      inputSchema: z.strictObject(targetSchema),
    },
    async (input) => jsonResult(await createFileUploadTokenForMcp(auth, input)),
  )

  server.registerTool(
    'get_file',
    {
      title: 'Get file',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        `Reads a file attached to ticket content or a comment (a \`${UPLOAD_URL_PREFIX}/<key>\` URL, or the key). ` +
        `A UTF-8 text file of ${MAX_INLINE_TEXT_SIZE / 1024}KB or less is returned as text. ` +
        `Otherwise returns its metadata and a curl command with a short-lived token to download it (valid for ${DOWNLOAD_TOKEN_TTL_SECONDS / 60} minutes). ` +
        'Use get_image to look at an image',
      inputSchema: z.strictObject({
        file: z.string().min(1).describe(`A \`${UPLOAD_URL_PREFIX}/<key>\` URL, or the key itself`),
      }),
    },
    async (input) => jsonResult(await getFileForMcp(auth, input)),
  )
}
