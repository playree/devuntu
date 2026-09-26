/**
 * チケット / コメントの書き込みに使う部品(サーバー専用)
 *
 * 番号の採番・添付の付け替え・返信先の検証・レーン移動。権限判定を済ませた後に
 * `ticket-mutation.ts` から同じトランザクション内で呼ぶ。
 */

import { Prisma } from '@/generated/prisma/client'
import type { TicketStatus } from '@/generated/prisma/enums'
import { nowDate } from '../day'
import { errInvalidOperation } from '../error'
import { type Db } from '../prisma'
import { extractUploadKeys, toUploadUrl } from '../storage/upload'
import type { Actor, TicketAccess } from './board-access'
import { insertAt, kanbanDoneSince, kanbanLaneWhere, reindexLane } from './kanban'

/**
 * ボード内のチケット番号を 1 つ払い出す。
 *
 * `UPDATE ... RETURNING` の行ロックで同一ボードへの同時作成が直列化されるため番号は重複しない。
 * シーケンスと違い、トランザクションがロールバックすればカウンタも戻るので欠番も出ない。
 * ロックはコミットまで残るので、チケット作成の直前に呼ぶこと。
 */
export const nextTicketNumber = async (tx: Prisma.TransactionClient, boardId: string): Promise<number> => {
  const { ticketSeq } = await tx.board.update({
    where: { id: boardId },
    data: { ticketSeq: { increment: 1 } },
    select: { ticketSeq: true },
  })
  return ticketSeq
}

/**
 * その添付が、指定チケット以外の本文から使われているかを調べる。
 *
 * 同じチケット(とそのコメント)からの参照は保存先ボードと同じボードなので、
 * 付け替えを止める理由にならない。`excludeTicketId` はそれを除くためのもの。
 */
const isAttachmentInUse = async (
  tx: Prisma.TransactionClient,
  key: string,
  excludeTicketId: string | undefined,
): Promise<boolean> => {
  const url = toUploadUrl(key)
  const ticket = await tx.ticket.findFirst({
    where: { content: { contains: url }, ...(excludeTicketId && { id: { not: excludeTicketId } }) },
    select: { id: true },
  })
  if (ticket) {
    return true
  }
  const comment = await tx.ticketComment.findFirst({
    where: { content: { contains: url }, ...(excludeTicketId && { ticketId: { not: excludeTicketId } }) },
    select: { id: true },
  })
  return comment !== null
}

/**
 * 本文に貼られた添付を、本文の保存先ボードへ紐付け直す。
 *
 * アップロードは本文の保存より前に走るので、作成フォームでボードを選び直すと添付だけが
 * 前のボードに残り、保存先ボードのメンバーが `/api/upload/<キー>` を読めなくなる。
 * 付け替えは本人がアップロードしたものに限る(他人の添付を自分のボードへ引き込めないようにする)。
 * 保存先ボードへのアクセスは呼び出し元で `assertBoardAccess` を通していること。
 *
 * 付け替えるのは**まだどの本文からも使われていない**添付だけ。既に別のボードの本文で
 * 使われている画像を貼り直したときに動かしてしまうと、元のボードのメンバーからその本文の画像が
 * 読めなくなる(添付の可視範囲は Attachment.boardId 1つで決まるため)。
 * 使用中のものは動かさないので、貼り直した先では元のボードのメンバーにしか見えない。
 *
 * チケット自身はボードを移動しない前提で成り立っている(docs/development.md
 * 「チケットはボードを移動しない」)。移動を許容する場合はここも設計し直すこと。
 */
export const reassignContentAttachments = async (
  tx: Prisma.TransactionClient,
  content: string | null | undefined,
  boardId: string,
  actor: Actor,
  /** 保存対象のチケット。このチケットとそのコメントからの参照は「使用中」に数えない */
  excludeTicketId?: string,
): Promise<void> => {
  const keys = content ? extractUploadKeys(content) : []
  if (keys.length === 0) {
    return
  }

  // 保存先と同じボードの添付・他人の添付は対象外。通常はここが0件で終わる
  const candidates = await tx.attachment.findMany({
    where: { key: { in: keys }, createdById: actor.id, boardId: { not: boardId } },
    select: { key: true },
  })
  if (candidates.length === 0) {
    return
  }

  const movable: string[] = []
  for (const { key } of candidates) {
    if (!(await isAttachmentInUse(tx, key, excludeTicketId))) {
      movable.push(key)
    }
  }
  if (movable.length === 0) {
    return
  }

  await tx.attachment.updateMany({ where: { key: { in: movable } }, data: { boardId } })
}

/**
 * コメントの返信先(parentId)が返信可能な相手かを検証する。NG なら errInvalidOperation() を throw。
 * スレッドは 1 階層のみ許容するため、返信先自体が既に返信(parentId を持つ)である場合は拒否する。
 * 投稿先チケットと親コメントの所属チケットが一致しない(他チケットのコメントIDを指定した)場合も拒否する。
 */
export const assertReplyTarget = async (tx: Db, ticketId: string, parentId: string): Promise<void> => {
  const parent = await tx.ticketComment.findUnique({
    where: { id: parentId },
    select: { ticketId: true, parentId: true },
  })
  if (!parent || parent.parentId || parent.ticketId !== ticketId) {
    throw errInvalidOperation()
  }
}

/**
 * チケットのステータス / レーン位置を更新するコア。
 * かんばんの DnD・カード内メニュー・詳細画面のステータス変更が共有する唯一の経路。
 *
 * `index` を省略すると移動先レーンの末尾へ入る。
 * レーン内は 0..n-1 の連番へ再採番する(行ごとに異なる値になるため updateMany では書けず、生 SQL で 1 文にまとめる)。
 *
 * 採番の対象は盤面に表示されるカードだけ。かんばんに出ない古い完了カードは読まず order も触らないので、
 * クライアントが送る index(盤面に見えているカードだけを数えた位置)とそのまま基準が揃う。
 */
export const moveTicketToLane = async (
  tx: Prisma.TransactionClient,
  {
    access,
    status,
    index,
  }: { access: Pick<TicketAccess, 'ticketId' | 'boardId' | 'status'>; status: TicketStatus; index?: number },
): Promise<{ id: string; status: TicketStatus; order: number }> => {
  // レーンは「同一ボード + 同一ステータス」で決まる
  const lane = await tx.ticket.findMany({
    where: kanbanLaneWhere(access.boardId, status, kanbanDoneSince(nowDate())),
    select: { id: true, order: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })

  const currentOrder = new Map(lane.map(({ id, order }) => [id, order]))
  const rest = lane.map((ticket) => ticket.id).filter((id) => id !== access.ticketId)
  const position = index ?? rest.length
  const ordered = reindexLane(insertAt(rest, access.ticketId, position))

  // 移動対象は status も変わるので 1 回の update にまとめる
  const moved = ordered.find(({ id }) => id === access.ticketId)
  const movedOrder = moved?.order ?? position
  await tx.ticket.update({
    where: { id: access.ticketId },
    data: {
      status,
      order: movedOrder,
      // 同一レーン内の並べ替えでは完了日時を書き換えない
      ...(access.status !== status && { completedAt: status === 'done' ? nowDate() : null }),
    },
  })

  // MAX_KANBAN_CARDS(500)まで入りうるレーンで毎回全行を UPDATE しないよう、order が変わる行だけ触る
  const shifted = ordered.filter(({ id, order }) => id !== access.ticketId && currentOrder.get(id) !== order)
  if (shifted.length > 0) {
    /**
     * レーン先頭への移動では実質全行が対象になるため、1 行ずつではなく 1 文で更新する。
     * 生 SQL では `@updatedAt` が効かないので、1 行ずつ update していたときと同じになるよう明示的に触る。
     */
    await tx.$executeRaw`
      UPDATE "ticket" AS t
      SET "order" = v."order", "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(
        shifted.map(({ id, order }) => Prisma.sql`(${id}::text, ${order}::int)`),
      )}) AS v(id, "order")
      WHERE t.id = v.id
    `
  }

  return { id: access.ticketId, status, order: movedOrder }
}
