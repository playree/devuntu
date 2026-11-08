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
import { toUploadUrl } from './upload'

/** 可視判定に要る添付の項目 */
export type AttachmentScope = { key: string; boardId: string | null; wikiSpaceId: string | null }

/**
 * 添付を配信してよいか。配信API と MCP の画像・ファイル取得で共通に使う。
 *
 * Wiki スペースの添付は、そのスペースを閲覧できる人だけに配信する(割り当ての無い管理者は本文と同じく読めない)。
 * どこにも属さない添付(お知らせ / リンクウィジェットのアイコン)は全ログインユーザーへ配信する。
 * ボードのメンバーでない承認者には、承認対象(担当が自分の承認するエージェント)のチケット本文か
 * そのコメントから参照されている添付だけを許す。ボード単位で許すと、同じボードの無関係な
 * チケットの画像までキーさえ分かれば読めてしまう。
 */
export const canViewAttachment = async (actor: Actor, attachment: AttachmentScope): Promise<boolean> => {
  const { key, boardId, wikiSpaceId } = attachment
  if (wikiSpaceId) {
    return (await getWikiSpaceAccess(actor, wikiSpaceId))?.canView ?? false
  }
  if (!boardId) {
    return true
  }
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
