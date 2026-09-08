/**
 * 添付キーの参照元を探す(サーバー専用)
 *
 * `Attachment` への外部キーは無く、参照はすべて文字列で持たれている。
 * 本文(Markdown)の中の `/api/upload/<キー>` と、URLをそのまま持つ列の2種類があるので、
 * 「参照されている」の判断はこのファイルに閉じる。
 *
 * 本文側の抽出は `extractUploadKeys()` をそのまま使う。保存する側と同じ関数を通すことで、
 * 掃除する側の「参照されている」が書き込む側の定義とずれない。
 */

import { getString } from '../kvs'
import { ATTACHMENT_SCAN_BATCH } from '../maintenance/maintenance'
import { prisma } from '../prisma'
import { extractUploadKeys, toUploadKey, toUploadUrl, UPLOAD_URL_PREFIX } from './upload'

/** 添付を参照しうる場所 */
export type AttachmentRefSource = 'ticket' | 'comment' | 'user' | 'linkWidget' | 'announcement'

/** 本文にアップロードURLを含む行だけを対象にする条件 */
const hasUploadUrl = { content: { contains: UPLOAD_URL_PREFIX } }

/**
 * 本文を持つテーブルをページングしながらキーだけを集める。
 *
 * 本文はページごとに捨てるので、チケットが増えてもメモリに載るのはキーの集合だけになる。
 * ページ送りは主キー(uuidv7 = 作成順)のカーソルで行い、走査中に行が消えてもずれない。
 */
const collectFromContent = async (
  findMany: (args: {
    where: typeof hasUploadUrl
    select: { id: true; content: true }
    orderBy: { id: 'asc' }
    take: number
    cursor?: { id: string }
    skip?: number
  }) => Promise<{ id: string; content: string | null }[]>,
  keys: Set<string>,
): Promise<void> => {
  let cursor: string | undefined
  for (;;) {
    const rows = await findMany({
      where: hasUploadUrl,
      select: { id: true, content: true },
      orderBy: { id: 'asc' },
      take: ATTACHMENT_SCAN_BATCH,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    })
    for (const row of rows) {
      for (const key of extractUploadKeys(row.content ?? '')) {
        keys.add(key)
      }
    }
    if (rows.length < ATTACHMENT_SCAN_BATCH) {
      return
    }
    cursor = rows[rows.length - 1].id
  }
}

/** URL文字列をそのまま持つ列から、アップロードのキーだけを取り出す */
const toKeys = (urls: (string | null)[]): string[] =>
  urls.filter((url): url is string => !!url && url.startsWith(UPLOAD_URL_PREFIX)).map(toUploadKey)

/**
 * いずれかの場所から参照されている添付キーを集める。
 *
 * 添付1件ごとに全本文へ部分一致を掛けると添付数×本文数の走査になるため、
 * 先に1回の走査で集合を作り、これを候補の絞り込みに使う。
 */
export const collectReferencedUploadKeys = async (): Promise<Set<string>> => {
  const keys = new Set<string>()

  await collectFromContent((args) => prisma.ticket.findMany(args), keys)
  await collectFromContent((args) => prisma.ticketComment.findMany(args), keys)

  const [users, widgets, announcement] = await Promise.all([
    prisma.user.findMany({ where: { image: { startsWith: UPLOAD_URL_PREFIX } }, select: { image: true } }),
    prisma.linkWidget.findMany({
      where: { iconPath: { startsWith: UPLOAD_URL_PREFIX } },
      select: { iconPath: true },
    }),
    getString('DASHBOARD_ANNOUNCEMENT'),
  ])

  for (const key of toKeys(users.map(({ image }) => image))) {
    keys.add(key)
  }
  for (const key of toKeys(widgets.map(({ iconPath }) => iconPath))) {
    keys.add(key)
  }
  for (const key of extractUploadKeys(announcement?.value ?? '')) {
    keys.add(key)
  }

  return keys
}

/**
 * そのキーを今この瞬間に参照している場所を返す。参照が無ければ null。
 *
 * {@link collectReferencedUploadKeys} の集合を作ってから削除するまでの間に保存された本文を
 * 取りこぼさないための最終確認。候補が絞られた後にしか呼ばないので、部分一致の走査は少ない。
 */
export const findAttachmentReference = async (key: string): Promise<AttachmentRefSource | null> => {
  const url = toUploadUrl(key)

  if (await prisma.ticket.findFirst({ where: { content: { contains: url } }, select: { id: true } })) {
    return 'ticket'
  }
  if (await prisma.ticketComment.findFirst({ where: { content: { contains: url } }, select: { id: true } })) {
    return 'comment'
  }
  if (await prisma.user.findFirst({ where: { image: url }, select: { id: true } })) {
    return 'user'
  }
  if (await prisma.linkWidget.findFirst({ where: { iconPath: url }, select: { id: true } })) {
    return 'linkWidget'
  }

  const announcement = await getString('DASHBOARD_ANNOUNCEMENT')
  return announcement?.value.includes(url) ? 'announcement' : null
}
