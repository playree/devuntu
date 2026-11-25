/**
 * Wiki のアナウンス用スペースの一覧とバックナンバー(サーバー専用)
 *
 * アナウンスは増え続けるので、全件の木は返さず、作成日時の新しい順にサーバー側でページングする。
 * 年月の区切りは閲覧者のタイムゾーン(未設定ならサーバーの既定)で決める。閲覧は viewer 以上。
 */

import { Prisma } from '@/generated/prisma/client'
import { getUserNameAndTimezone } from '../auth/user-profile'
import type { Actor } from '../board/board-access'
import { errInvalidOperation } from '../error'
import { prisma, type Db } from '../prisma'
import { assertWikiSpaceAccess, type WikiSpaceAccess } from './wiki-access'
import { canSeeWikiAnnounce, wikiAnnounceStateOf, type WikiAnnounceState } from './wiki-announcement-notify-rule'
import {
  MAX_WIKI_ANNOUNCEMENT_PAGE_SIZE,
  MAX_WIKI_ANNOUNCEMENT_TREE,
  wikiAnnouncementPeriodRange,
  type WikiAnnouncementMonthCount,
  type WikiAnnouncementPeriod,
} from './wiki-announcement-rule'
import { WIKI_PAGE_ALIVE, wikiSpaceTypeSpec } from './wiki-rule'

export type WikiAnnouncementItem = {
  id: string
  number: number
  title: string
  createdAt: Date
  createdByName: string
  tagIds: string[]
  /** Slack 通知の状態。editor 以上にだけ返す */
  notifyState?: WikiAnnounceState
}

export type WikiAnnouncementQuery = WikiAnnouncementPeriod & {
  /** スペースのタグの ID。付いているアナウンスだけにする */
  tagId?: string
  /** 1 始まり */
  page: number
  rowsPerPage: number
}

/** `assertWikiSpaceAccess` に加えて、アナウンス用の区分(`WIKI_SPACE_TYPE_SPEC` の announce)であることを確かめる */
export const assertWikiAnnouncementSpace = async (
  actor: Actor,
  spaceId: string,
  need: 'view' | 'write' | 'manage',
  tx?: Db,
): Promise<WikiSpaceAccess> => {
  const access = await assertWikiSpaceAccess(actor, spaceId, need, tx)
  if (!wikiSpaceTypeSpec(access.type).announce) {
    throw errInvalidOperation()
  }
  return access
}

/** 作成日時の新しい順(同時刻なら番号の大きい順)の 1 ページ分と、条件に合う総件数 */
const queryAnnouncements = async (where: Prisma.WikiPageWhereInput, page: { skip?: number; take: number }) => {
  const [rows, total] = await Promise.all([
    prisma.wikiPage.findMany({
      where,
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        tags: { select: { tagId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
      ...page,
    }),
    prisma.wikiPage.count({ where }),
  ])
  return {
    items: rows.map(({ createdBy, tags, ...row }) => ({
      ...row,
      createdByName: createdBy?.name ?? '',
      tagIds: tags.map(({ tagId }) => tagId),
    })),
    total,
  }
}

/** 作成日時の新しい順(同時刻なら番号の大きい順)の 1 ページ分と、絞り込み後の総件数 */
export const listWikiAnnouncements = async (
  actor: Actor,
  spaceId: string,
  { month, year, tagId, page, rowsPerPage }: WikiAnnouncementQuery,
): Promise<{ items: WikiAnnouncementItem[]; total: number }> => {
  const access = await assertWikiAnnouncementSpace(actor, spaceId, 'view')
  const range =
    month || year
      ? wikiAnnouncementPeriodRange({ month, year }, (await getUserNameAndTimezone(actor.id)).timezone)
      : null
  const take = Math.min(Math.max(rowsPerPage, 1), MAX_WIKI_ANNOUNCEMENT_PAGE_SIZE)
  const { items, total } = await queryAnnouncements(
    {
      spaceId,
      ...WIKI_PAGE_ALIVE,
      ...(range ? { createdAt: { gte: range.gte, lt: range.lt } } : {}),
      ...(tagId ? { tags: { some: { tagId } } } : {}),
    },
    { skip: (Math.max(page, 1) - 1) * take, take },
  )
  const states = canSeeWikiAnnounce(access.role) ? await notifyStatesOf(items.map(({ id }) => id)) : null
  return {
    items: states ? items.map((item) => ({ ...item, notifyState: states.get(item.id) ?? 'none' })) : items,
    total,
  }
}

/** ページごとの Slack 通知の状態。予約中・送信済みの行があるかだけを見る */
const notifyStatesOf = async (pageIds: string[]): Promise<Map<string, WikiAnnounceState>> => {
  if (pageIds.length === 0) {
    return new Map()
  }
  const rows = await prisma.wikiAnnouncementNotify.findMany({
    where: { pageId: { in: pageIds }, status: { in: ['scheduled', 'sent'] } },
    select: { pageId: true, status: true },
    distinct: ['pageId', 'status'],
  })
  return new Map(
    pageIds.map((id) => [id, wikiAnnounceStateOf(rows.filter((row) => row.pageId === id).map(({ status }) => status))]),
  )
}

/** 年月(閲覧者のタイムゾーン)ごとの件数。新しい順。タグを渡すとそのタグを持つアナウンスだけを数える(一覧の絞り込みと件数を揃える) */
export const getWikiAnnouncementArchive = async (
  actor: Actor,
  spaceId: string,
  { tagId }: { tagId?: string } = {},
): Promise<WikiAnnouncementMonthCount[]> => {
  await assertWikiAnnouncementSpace(actor, spaceId, 'view')
  const { timezone } = await getUserNameAndTimezone(actor.id)
  const tagFilter = tagId
    ? Prisma.sql`AND p."id" IN (SELECT "pageId" FROM "wiki_page_tag" WHERE "tagId" = ${tagId})`
    : Prisma.empty
  // createdAt は UTC の timestamp(タイムゾーンなし)なので、UTC として読んでから閲覧者のタイムゾーンへ移す
  return prisma.$queryRaw<WikiAnnouncementMonthCount[]>`
    SELECT to_char((p."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM') AS "month", count(*)::int AS "count"
    FROM "wiki_page" p
    WHERE p."spaceId" = ${spaceId} AND p."deletedAt" IS NULL ${tagFilter}
    GROUP BY 1
    ORDER BY 1 DESC
  `
}

/**
 * MCP の get_wiki_tree 用。アナウンス用スペースのページ(本文なし)を作成日時の新しい順に、
 * 上限(`MAX_WIKI_ANNOUNCEMENT_TREE`)まで返す。総件数も添える(古いものは search_wiki で探す)
 */
export const listRecentWikiAnnouncements = async (
  actor: Actor,
  spaceId: string,
): Promise<{ items: { number: number; title: string; createdAt: Date; tagIds: string[] }[]; total: number }> => {
  await assertWikiAnnouncementSpace(actor, spaceId, 'view')
  const { items, total } = await queryAnnouncements(
    { spaceId, ...WIKI_PAGE_ALIVE },
    { take: MAX_WIKI_ANNOUNCEMENT_TREE },
  )
  return { items: items.map(({ number, title, createdAt, tagIds }) => ({ number, title, createdAt, tagIds })), total }
}
