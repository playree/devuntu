/**
 * 添付の配信可否(サーバー専用)
 *
 * 添付先(ボード / Wiki スペース)ごとの可視判定をまとめる。
 * ボードと Wiki の両方の認可に依存するため、どちらの access にも置かずここに切り出す
 * (`wiki-access.ts` が `board-access.ts` を import しているので、逆向きに置くと循環する)。
 */

import { approvableAgentWhere } from '../agent/agent-approver'
import { getBoardAccess, type Actor } from '../board/board-access'
import { prisma } from '../prisma'
import { getWikiSpaceAccess } from '../wiki/wiki-access'
import { storedAttachmentOwnerOf, type StoredAttachmentOwner } from './attachment-owner'
import { toUploadUrl } from './upload'

/** 可視判定に要る添付の項目 */
export type AttachmentScope = { key: string; owner: StoredAttachmentOwner }

/**
 * 添付を配信してよいか。配信API と MCP の画像・ファイル取得で共通に使う。
 *
 * Wiki スペースの添付は、そのスペースを閲覧できる人だけに配信する(割り当ての無い管理者は本文と同じく読めない)。
 * ボード / スペースの削除で紐付けを外した添付(削除待ち)は、元の閲覧範囲が分からないので誰にも配信しない。
 * それ以外のどこにも属さない添付(お知らせ / リンクウィジェットのアイコン)は全ログインユーザーへ配信する。
 * ボードのメンバーでない承認者には、承認対象(担当が自分の承認するエージェント)のチケット本文か
 * そのコメントから参照されている添付だけを許す。ボード単位で許すと、同じボードの無関係な
 * チケットの画像までキーさえ分かれば読めてしまう。
 */
export const canViewAttachment = async (actor: Actor, { key, owner }: AttachmentScope): Promise<boolean> => {
  switch (owner.kind) {
    case 'detached':
      return false
    case 'public':
      return true
    case 'wikiSpace':
      return (await getWikiSpaceAccess(actor, owner.wikiSpaceId))?.canView ?? false
    case 'board':
      return canViewBoardAttachment(actor, key, owner.boardId)
  }
}

const canViewBoardAttachment = async (actor: Actor, key: string, boardId: string): Promise<boolean> => {
  if (await getBoardAccess(actor, boardId)) {
    return true
  }
  const url = toUploadUrl(key)
  const count = await prisma.ticket.count({
    where: {
      boardId,
      assignee: approvableAgentWhere(actor.id),
      OR: [{ content: { contains: url } }, { comments: { some: { content: { contains: url } } } }],
    },
  })
  return count > 0
}

/** 配信に使う添付の項目 */
export type ViewableAttachment = { originalName: string; size: number; mimeType: string }

/**
 * キーで添付を引き、`actor` に配信してよければ返す(配信API と MCP の画像・ファイル取得で共通)。
 * 存在しない・配信できないものは区別せず null を返し、キーの当たり判定を返さない
 */
export const findViewableAttachment = async (actor: Actor, key: string): Promise<ViewableAttachment | null> => {
  const attachment = await prisma.attachment.findUnique({
    where: { key },
    select: { boardId: true, wikiSpaceId: true, detachedAt: true, originalName: true, size: true, mimeType: true },
  })
  if (!attachment) {
    return null
  }
  const { boardId, wikiSpaceId, detachedAt, ...meta } = attachment
  const owner = storedAttachmentOwnerOf({ boardId, wikiSpaceId, detachedAt })
  return (await canViewAttachment(actor, { key, owner })) ? meta : null
}
