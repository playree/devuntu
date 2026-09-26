/**
 * チケット / コメントの変更処理(サーバー専用)
 *
 * Web(Server Action)と MCP の両方がここを通る。経路ごとに持つのは入力の変換と
 * 経路固有の追加制限(`authorize`)だけにして、権限判定・メンション・添付・通知の扱いを揃える。
 */

import type { TicketCommentType, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { dateOnlyToUtc, nowDate } from '../day'
import { errInvalidOperation } from '../error'
import {
  enqueueTicketCommented,
  enqueueTicketCompletedByMerge,
  enqueueTicketCreated,
  enqueueTicketMoved,
  enqueueTicketUpdated,
} from '../notify/notify-trigger'
import { prisma } from '../prisma'
import { type Actor, assertBoardAccess, assertTicketAccess, type TicketAccess } from './board-access'
import { assertBoardAssignee, getBoardMentionCandidates, getTicketMentionCandidates } from './board-member'
import { extractMentionEmails, resolveMentionUserIds } from './mention'
import { assertTagIdsInBoard, syncTicketTags } from './tag'
import { nextOrder } from './tag-rule'
import { ticketDisplayId } from './ticket-id'
import { assertReplyTarget, moveTicketToLane, nextTicketNumber, reassignContentAttachments } from './ticket-write'

/** 経路固有の追加制限。`assertTicketAccess` を通った直後に同じトランザクション内で呼ぶ。NG なら throw する */
export type TicketAuthorize = (access: TicketAccess) => void

export type CreateTicketInput = {
  boardId: string
  title: string
  content?: string
  status: TicketStatus
  priority: TicketPriority
  dueDate?: string | null
  assigneeId?: string | null
  tagIds: string[]
}

/**
 * チケット作成。
 * 担当者・タグがそのボードに属することは DB 制約では防げないのでここで検証する。
 */
export const createTicket = async (actor: Actor, input: CreateTicketInput) => {
  const { boardId, status, assigneeId, tagIds, dueDate, ...rest } = input

  return prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, boardId, 'write', tx)
    await assertBoardAssignee(tx, boardId, assigneeId)
    const ids = await assertTagIdsInBoard(tx, boardId, tagIds)

    // 採番はボード行をロックする。レーンの読み取りより先に取ることで、同一ボードへの同時作成は
    // 先行トランザクションのコミット後にレーンを読み直すことになり、order の重複も防げる
    const number = await nextTicketNumber(tx, boardId)
    // 対象レーンの末尾へ追加する。必要なのは最大値だけなので全行は読まない
    const lane = await tx.ticket.aggregate({ where: { boardId, status }, _max: { order: true } })

    const candidates = await getBoardMentionCandidates(boardId, tx)
    const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(rest.content ?? ''), candidates)

    const created = await tx.ticket.create({
      data: {
        ...rest,
        number,
        status,
        boardId,
        dueDate: dateOnlyToUtc(dueDate),
        // 最初から完了で作ることもできるので、その場合はここで完了日時を入れる
        completedAt: status === 'done' ? nowDate() : null,
        createdById: actor.id,
        assigneeId: assigneeId ?? null,
        mentionedUserIds,
        tags: { create: ids.map((tagId) => ({ tagId })) },
        order: nextOrder(lane._max.order === null ? [] : [lane._max.order]),
      },
      select: { id: true, title: true, number: true, board: { select: { key: true } } },
    })

    // 本文の画像はボードを選び直す前にアップロードされている場合があるので、作成先へ付け替える。
    // 作成直後に呼ぶので、いま作ったチケット自身は「使用中」から除く
    await reassignContentAttachments(tx, rest.content, boardId, actor, created.id)

    const ticket = {
      id: created.id,
      title: created.title,
      displayId: ticketDisplayId({ key: created.board.key, number: created.number }),
    }

    // 作成と同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    await enqueueTicketCreated(
      {
        actorId: actor.id,
        ticket: { id: ticket.id, boardId, displayId: ticket.displayId, title: ticket.title },
        assigneeId: assigneeId ?? null,
        status,
        mentionedUserIds,
      },
      tx,
    )

    return ticket
  })
}

/** undefined = 変更しない / null = クリア */
export type UpdateTicketInput = {
  title?: string
  content?: string
  priority?: TicketPriority
  dueDate?: string | null
  assigneeId?: string | null
  tagIds?: string[]
  /** 指定するとレーンの末尾へ移す。Web の詳細画面は changeTicketStatus を別に呼ぶので渡さない */
  status?: TicketStatus
}

/**
 * チケットの部分更新。
 * agentMode は承認者だけが設定できるので受け取らない。担当が変わったときに消すだけ。
 */
export const updateTicket = async (
  actor: Actor,
  id: string,
  input: UpdateTicketInput,
  opts?: { authorize?: TicketAuthorize },
) => {
  const { assigneeId, tagIds, dueDate, status, ...rest } = input

  return prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(actor, id, 'edit', tx)
    opts?.authorize?.(access)
    // 通知の判断に使う変更前の状態。認可の問い合わせで既に読めているので追加の SELECT は要らない
    const before = { assigneeId: access.assigneeId, status: access.status }

    if (assigneeId !== undefined) {
      await assertBoardAssignee(tx, access.boardId, assigneeId)
    }
    const ids = tagIds !== undefined ? await assertTagIdsInBoard(tx, access.boardId, tagIds) : undefined
    const nextAssigneeId = assigneeId !== undefined ? (assigneeId ?? null) : before.assigneeId

    // 本文を書き換えるときだけメンションを解き直す
    let mentionedUserIds: string[] | undefined
    let addedMentionUserIds: string[] = []
    if (rest.content !== undefined) {
      const current = await tx.ticket.findUniqueOrThrow({ where: { id }, select: { mentionedUserIds: true } })
      const candidates = await getTicketMentionCandidates(access, tx)
      mentionedUserIds = resolveMentionUserIds(extractMentionEmails(rest.content), candidates)
      // 本文を編集し直すたびに同じ相手へ通知しないよう、増えた分だけを通知対象にする
      addedMentionUserIds = mentionedUserIds.filter((userId) => !current.mentionedUserIds.includes(userId))
      await reassignContentAttachments(tx, rest.content, access.boardId, actor, id)
    }

    const updated = await tx.ticket.update({
      where: { id },
      data: {
        ...rest,
        ...(dueDate !== undefined && { dueDate: dateOnlyToUtc(dueDate) }),
        ...(assigneeId !== undefined && { assigneeId: nextAssigneeId }),
        /**
         * 承認は「そのエージェントに任せる」判断なので、担当が変わったら付け替え先が何であっても消す。
         * 残すとランナーが別のエージェントで、前の承認のまま自動実行してしまう
         */
        ...(nextAssigneeId !== before.assigneeId && { agentMode: null, agentState: null }),
        mentionedUserIds,
      },
      select: { id: true, title: true, number: true, status: true, board: { select: { key: true } } },
    })
    if (ids) {
      await syncTicketTags(tx, id, ids)
    }

    const moved =
      status !== undefined && status !== access.status ? await moveTicketToLane(tx, { access, status }) : null
    const displayId = ticketDisplayId({ key: updated.board.key, number: updated.number })
    const ticket = { id: updated.id, title: updated.title, displayId, status: moved?.status ?? updated.status }

    // 更新と同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    await enqueueTicketUpdated(
      {
        actorId: actor.id,
        ticket: { id, boardId: access.boardId, displayId, title: ticket.title },
        before,
        after: { assigneeId: nextAssigneeId, status: ticket.status },
        addedMentionUserIds,
      },
      tx,
    )

    return ticket
  })
}

/** チケット削除。TicketComment は onDelete: Cascade で自動削除される */
export const deleteTicket = async (actor: Actor, id: string, opts?: { authorize?: TicketAuthorize }) => {
  await prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(actor, id, 'delete', tx)
    opts?.authorize?.(access)
    await tx.ticket.delete({ where: { id } })
  })
  return { id }
}

/**
 * ステータス / レーン位置の変更(詳細画面のステータス変更・かんばんの DnD / カード内メニュー)。
 * `index` を省略すると移動先レーンの末尾へ入る。
 */
export const changeTicketStatus = async (actor: Actor, id: string, status: TicketStatus, index?: number) =>
  prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(actor, id, 'edit', tx)
    const lane = await moveTicketToLane(tx, { access, status, index })

    // 移動と同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    await enqueueTicketMoved({ actorId: actor.id, ticketId: id, before: access.status, after: lane.status }, tx)
    return lane
  })

/**
 * PR のマージによる自動完了(GitHub 連携)。操作した人はいないのでシステムの操作として扱い、権限の判定は挟まない。
 * 対象を絞るのは呼び出し元(Webhook)の責務で、ここではアーカイブ済みのボードと完了済みのチケットだけを除く。
 * 完了へ動かしたら true。
 */
export const completeTicketByMerge = async (ticketId: string, pullRequest: string): Promise<boolean> =>
  prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, boardId: true, status: true, board: { select: { archived: true } } },
    })
    if (!ticket || ticket.board.archived || ticket.status === 'done') {
      return false
    }

    await moveTicketToLane(tx, {
      access: { ticketId: ticket.id, boardId: ticket.boardId, status: ticket.status },
      status: 'done',
    })
    await enqueueTicketCompletedByMerge({ ticketId, pullRequest }, tx)
    return true
  })

export type AddCommentInput = {
  ticketId: string
  content: string
  type?: TicketCommentType | null
  parentId?: string | null
}

/** コメント投稿(メンションの解決を含む) */
export const addComment = async (actor: Actor, input: AddCommentInput) => {
  const { ticketId, content, type, parentId } = input

  return prisma.$transaction(async (tx) => {
    const access = await assertTicketAccess(actor, ticketId, 'edit', tx)
    if (parentId) {
      await assertReplyTarget(tx, ticketId, parentId)
    }

    const candidates = await getTicketMentionCandidates(access, tx)
    const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(content), candidates)
    await reassignContentAttachments(tx, content, access.boardId, actor, ticketId)

    const comment = await tx.ticketComment.create({
      data: { ticketId, authorId: actor.id, content, type, parentId, mentionedUserIds },
      select: { id: true },
    })

    // 検索(更新日時順)の観点でチケット側の updatedAt も更新する
    // 通知の見出しに使う表示ID / 件名はこの update の戻りから取る(追加の SELECT を増やさない)
    const ticket = await tx.ticket.update({
      where: { id: ticketId },
      data: { updatedAt: nowDate() },
      select: { number: true, title: true, board: { select: { key: true } } },
    })

    // 投稿と同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    await enqueueTicketCommented(
      {
        actorId: actor.id,
        ticket: {
          id: ticketId,
          boardId: access.boardId,
          displayId: ticketDisplayId({ key: ticket.board.key, number: ticket.number }),
          title: ticket.title,
        },
        comment: { id: comment.id, content },
        addedMentionUserIds: mentionedUserIds,
      },
      tx,
    )

    return { id: comment.id, mentionedUserIds }
  })
}

/** コメント更新(投稿者本人のみ) */
export const updateComment = async (actor: Actor, id: string, content: string) =>
  prisma.$transaction(async (tx) => {
    const target = await tx.ticketComment.findUnique({
      where: { id },
      select: {
        ticketId: true,
        authorId: true,
        mentionedUserIds: true,
        // 通知の見出しに使う表示ID / 件名。この SELECT で併せて取り、追加の問い合わせを増やさない
        ticket: { select: { number: true, title: true, board: { select: { key: true } } } },
      },
    })
    if (!target || target.authorId !== actor.id) {
      throw errInvalidOperation()
    }

    const access = await assertTicketAccess(actor, target.ticketId, 'edit', tx)
    const candidates = await getTicketMentionCandidates(access, tx)
    const mentionedUserIds = resolveMentionUserIds(extractMentionEmails(content), candidates)
    await reassignContentAttachments(tx, content, access.boardId, actor, target.ticketId)

    await tx.ticketComment.update({ where: { id }, data: { content, mentionedUserIds } })
    // 検索(更新日時順)の観点でチケット側の updatedAt も更新する
    await tx.ticket.update({ where: { id: target.ticketId }, data: { updatedAt: nowDate() } })

    // 更新と同じトランザクションで投入する(コミット後に落ちると通知だけが消える)
    await enqueueTicketCommented(
      {
        actorId: actor.id,
        ticket: {
          id: target.ticketId,
          boardId: access.boardId,
          displayId: ticketDisplayId({ key: target.ticket.board.key, number: target.ticket.number }),
          title: target.ticket.title,
        },
        comment: { id, content },
        // コメントを編集し直すたびに同じ相手へ通知しないよう、増えた分だけを通知対象にする
        addedMentionUserIds: mentionedUserIds.filter((userId) => !target.mentionedUserIds.includes(userId)),
      },
      tx,
    )

    return { id, mentionedUserIds }
  })

/** コメント削除(投稿者本人、またはチケットを削除できる権限を持つ人) */
export const deleteComment = async (actor: Actor, id: string) => {
  await prisma.$transaction(async (tx) => {
    const target = await tx.ticketComment.findUnique({ where: { id }, select: { ticketId: true, authorId: true } })
    if (!target) {
      throw errInvalidOperation()
    }

    const access = await assertTicketAccess(actor, target.ticketId, 'edit', tx)
    if (target.authorId !== actor.id && !access.canDelete) {
      throw errInvalidOperation()
    }

    await tx.ticketComment.delete({ where: { id } })
  })
  return { id }
}
