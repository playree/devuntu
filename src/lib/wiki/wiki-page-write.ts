/**
 * Wiki ページの書き込み(wiki-page / wiki-page-tree / wiki-page-restore)で共通に使う部品(サーバー専用)
 *
 * エラー・入力の検証・版に残すスナップショット・競合判定。ロックの順序は wiki-lock.ts を参照。
 */

import type { Prisma } from '@/generated/prisma/client'
import type { WikiPageType } from '@/generated/prisma/enums'
import { getTicketAccess, type Actor } from '../board/board-access'
import { ClientError, errInvalidOperation, errValidation } from '../error'
import { prisma, type Db } from '../prisma'
import type { WikiSpaceAccess } from './wiki-access'
import {
  MAX_WIKI_CONTENT,
  MAX_WIKI_DEPTH,
  MAX_WIKI_REVISION_MESSAGE,
  MAX_WIKI_TITLE,
  WIKI_ANNOUNCEMENT_FLAT,
  WIKI_PAGE_CONFLICT,
  WIKI_PAGE_INVALID_PARENT,
  WIKI_PAGE_TOO_DEEP,
  WIKI_PAGE_TYPE_NOT_ALLOWED,
  WIKI_TREE_CHANGED,
  isWikiPageTypeAllowed,
  wikiPageTypeRuleMessage,
  type WikiPageSnapshot,
} from './wiki-rule'

// MCP からも返すので、AI が次の手を選べるようメッセージに理由と対処を書く
const errWikiPageConflict = () =>
  new ClientError(WIKI_PAGE_CONFLICT, 'The page was updated by someone else after you read it. Read it again and retry')
export const errTooDeep = () =>
  new ClientError(WIKI_PAGE_TOO_DEEP, `Pages can be nested at most ${MAX_WIKI_DEPTH} levels deep`)
export const errInvalidParent = () =>
  new ClientError(
    WIKI_PAGE_INVALID_PARENT,
    'The parent must be another page in the same space, and not the page itself or one of its descendants',
  )
export const errTreeChanged = () =>
  new ClientError(
    WIKI_TREE_CHANGED,
    'The page tree was changed by someone else after you read it. Read the tree again and retry',
  )
export const errWikiAnnouncementFlat = () =>
  new ClientError(
    WIKI_ANNOUNCEMENT_FLAT,
    'This space is an announcement space: pages are flat and ordered by creation date, so parent, position and moving are not available',
  )

/** スペースの区分で作れない種類なら弾く(スペース行のロックを取った後に読んだ区分で判定する) */
export const assertPageTypeAllowed = (access: WikiSpaceAccess, type: WikiPageType) => {
  if (!isWikiPageTypeAllowed(access.type, type)) {
    throw new ClientError(WIKI_PAGE_TYPE_NOT_ALLOWED, wikiPageTypeRuleMessage(access.type, 'pages'))
  }
}

export const assertTitle = (title: string) => {
  if (title.trim() === '' || title.length > MAX_WIKI_TITLE) {
    throw errValidation(`title must be 1 to ${MAX_WIKI_TITLE} characters`)
  }
}

export const assertContent = (content: string) => {
  if (content.length > MAX_WIKI_CONTENT) {
    throw errValidation(`content must be at most ${MAX_WIKI_CONTENT} characters`)
  }
}

/** 版に紐づけるチケット。閲覧できないチケットは紐づけない(存在の有無を区別させない) */
export const resolveRevisionTicketId = async (tx: Db, actor: Actor, ticketId: string | null | undefined) => {
  if (!ticketId) {
    return null
  }
  if (!(await getTicketAccess(actor, ticketId, tx))?.canView) {
    throw errValidation('ticketId must be a ticket you can view')
  }
  return ticketId
}

/** ページのタグの並び。タグ管理の表示順(同値なら名前順)にそろえる */
export const PAGE_TAG_ORDER: Prisma.WikiPageTagOrderByWithRelationInput[] = [
  { tag: { order: 'asc' } },
  { tag: { name: 'asc' } },
]

export const SNAPSHOT_SELECT = {
  parentId: true,
  order: true,
  title: true,
  content: true,
  type: true,
  tags: {
    select: { tag: { select: { id: true, name: true } } },
    orderBy: PAGE_TAG_ORDER,
  },
} as const

type SnapshotRow = {
  parentId: string | null
  order: number
  title: string
  content: string
  type: WikiPageType
  tags: { tag: { id: string; name: string } }[]
}

export const snapshotOf = ({ parentId, order, title, content, type, tags }: SnapshotRow): WikiPageSnapshot => ({
  parentId,
  order,
  title,
  content,
  type,
  tags: tags.map(({ tag }) => tag),
})

export type WikiPageWriteResult = {
  result: 'created' | 'updated' | 'moved' | 'unchanged'
  id: string
  /** `KEY/番号` */
  ref: string
  number: number
  updatedAt: Date
}

export type WriteOpts = { ticketId?: string | null }
/** 本文を書く操作(作成・更新)の版に付けるコミットメッセージ(任意) */
export type MessageOpts = { message?: string | null }
export type ExpectOpts = WriteOpts & { expectedUpdatedAt?: string }

/** コミットメッセージは前後の空白を除き、空なら付けない */
export const normalizeMessage = (message: string | null | undefined): string | null => {
  const trimmed = message?.trim() ?? ''
  if (trimmed.length > MAX_WIKI_REVISION_MESSAGE) {
    throw errValidation(`message must be at most ${MAX_WIKI_REVISION_MESSAGE} characters`)
  }
  return trimmed || null
}

/** `expectedUpdatedAt` が日時として読めなければ入力不正(競合と返すと、読み直しても解消しないため) */
export const parseExpectedUpdatedAt = (raw: string | undefined): number | null => {
  if (!raw) {
    return null
  }
  const time = new Date(raw).getTime()
  if (Number.isNaN(time)) {
    throw errValidation('expectedUpdatedAt must be an ISO 8601 date-time')
  }
  return time
}

export const assertNotConflicted = (expected: number | null, updatedAt: Date) => {
  if (expected !== null && expected !== updatedAt.getTime()) {
    throw errWikiPageConflict()
  }
}

/**
 * 対象ページのスペースを引く(ロックを取る前に要る)。無ければ errInvalidOperation。
 * スペースは変わらないので、ロックの後で削除済みかどうかを読み直す
 */
export const findPageSpace = async (pageId: string) => {
  const page = await prisma.wikiPage.findUnique({ where: { id: pageId }, select: { spaceId: true } })
  if (!page) {
    throw errInvalidOperation()
  }
  return page.spaceId
}
