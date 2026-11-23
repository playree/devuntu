/**
 * Wiki アナウンスの Slack 通知(サーバー専用)
 *
 * アナウンス用スペースのページを、スペースに設定したチャンネルへ知らせる。投稿(保存)とは別の操作で、
 * 今すぐ送るか、日時を指定して予約する。予約は `WikiAnnouncementNotify` に置き、
 * ワーカー(`wiki-announcement-notify-worker.ts`)が期限の来たものを送信時点の最新の内容で送る。
 * 送る・予約する・変える・取り消すのは editor 以上(canWrite)。
 */

import type { WikiAnnouncementNotifyKind, WikiAnnouncementNotifySkipReason } from '@/generated/prisma/enums'
import { getUserNameAndTimezone } from '../auth/user-profile'
import type { Actor } from '../board/board-access'
import { nowDate } from '../day'
import { ClientError, errInvalidOperation, errTooManyRequests, errValidation } from '../error'
import { logger } from '../logger'
import { announcementText } from '../notify/notify'
import { isSlackChannelPostEnabled } from '../notify/notify-board-setting'
import { enqueueNotify } from '../notify/notify-enqueue'
import type { NotifyPayload } from '../notify/notify-payload'
import { prisma, type Db } from '../prisma'
import { assertRateLimit } from '../rate-limit'
import { assertWikiSpaceAccess, getWikiSpaceAccess } from './wiki-access'
import {
  canSeeWikiAnnounce,
  isValidWikiAnnounceSchedule,
  MAX_WIKI_ANNOUNCE_MESSAGE,
  MAX_WIKI_ANNOUNCE_SCHEDULED_PER_PAGE,
  WIKI_ANNOUNCE_BATCH,
  WIKI_ANNOUNCE_INVALID_SCHEDULE,
  WIKI_ANNOUNCE_NOT_SCHEDULED,
  WIKI_ANNOUNCE_TOO_MANY_SCHEDULED,
  WIKI_ANNOUNCE_UNAVAILABLE,
} from './wiki-announcement-notify-rule'

export type WikiAnnounceInput = {
  kind: WikiAnnouncementNotifyKind
  /** 一言。空なら送信時に本文の先頭を抜粋する */
  message?: string | null
}

export type WikiAnnounceScheduleInput = WikiAnnounceInput & { scheduledAt: Date }

/** 操作の連打で Slack のチャンネルを埋めないための上限(今すぐ・予約の作成と変更の合計) */
const ANNOUNCE_RATE_LIMIT = { limit: 10, windowMs: 60 * 1000 }

/** 履歴に返す件数の上限 */
const MAX_HISTORY = 100

const errUnavailable = () =>
  new ClientError(WIKI_ANNOUNCE_UNAVAILABLE, 'Slack channel for announcements is not set, or Slack is disabled')
const errNotScheduled = () =>
  new ClientError(WIKI_ANNOUNCE_NOT_SCHEDULED, 'The notification is no longer scheduled (sent, canceled or skipped)')
const errInvalidSchedule = () =>
  new ClientError(WIKI_ANNOUNCE_INVALID_SCHEDULE, 'scheduledAt must be in the future and within a year')
const errTooManyScheduled = () =>
  new ClientError(
    WIKI_ANNOUNCE_TOO_MANY_SCHEDULED,
    `A page can have at most ${MAX_WIKI_ANNOUNCE_SCHEDULED_PER_PAGE} scheduled notifications`,
  )

/** 流量制限で通知キューへ投入できなかった(予約は残して次の周で送る) */
class AnnounceThrottled extends Error {}

const NOTIFY_SELECT = {
  id: true,
  pageId: true,
  kind: true,
  message: true,
  scheduledAt: true,
  status: true,
  sentAt: true,
  skipReason: true,
  createdAt: true,
  createdBy: { select: { name: true } },
} as const

const PAYLOAD_PAGE_SELECT = {
  id: true,
  spaceId: true,
  number: true,
  title: true,
  content: true,
  space: { select: { key: true } },
} as const

const normalizeMessage = (message: string | null | undefined): string | null => {
  const trimmed = message?.trim() ?? ''
  if (trimmed.length > MAX_WIKI_ANNOUNCE_MESSAGE) {
    throw errValidation(`message must be at most ${MAX_WIKI_ANNOUNCE_MESSAGE} characters`)
  }
  return trimmed || null
}

const assertSchedule = (scheduledAt: Date) => {
  if (Number.isNaN(scheduledAt.getTime()) || !isValidWikiAnnounceSchedule(scheduledAt, nowDate())) {
    throw errInvalidSchedule()
  }
}

/** 送る時点のページの内容から、通知キューへ入れるペイロードを作る */
const payloadOf = (
  page: { id: string; spaceId: string; number: number; title: string; content: string; space: { key: string } },
  notify: { kind: WikiAnnouncementNotifyKind; message: string | null },
  fromName: string,
): NotifyPayload<'wiki_announcement'> => {
  const excerpt = announcementText(notify.message ?? page.content)
  return {
    spaceId: page.spaceId,
    spaceKey: page.space.key,
    pageId: page.id,
    pageNumber: page.number,
    pageTitle: page.title,
    kind: notify.kind,
    fromName,
    ...(excerpt && { excerpt }),
  }
}

/**
 * アナウンス用スペースのページに書き込めること。スペース行を共有ロックし、
 * アーカイブ・区分の変更・ページの削除(どれもスペース行を排他ロックする)と直列にする
 */
const lockWritableAnnouncement = async (actor: Actor, pageId: string, tx: Db) => {
  const found = await tx.wikiPage.findUnique({ where: { id: pageId }, select: { spaceId: true } })
  if (!found) {
    throw errInvalidOperation()
  }
  await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${found.spaceId} FOR SHARE`
  const access = await assertWikiSpaceAccess(actor, found.spaceId, 'write', tx)
  if (access.type !== 'announcement') {
    throw errInvalidOperation()
  }
  // ロックを待つ間に消えていないか
  const page = await tx.wikiPage.findUnique({ where: { id: pageId }, select: PAYLOAD_PAGE_SELECT })
  if (!page) {
    throw errInvalidOperation()
  }
  return page
}

/** 送れる状態か(通知先のチャンネルが設定済みで、Slack 連携が有効) */
const assertChannelReady = async (spaceId: string, tx: Db) => {
  const space = await tx.wikiSpace.findUnique({ where: { id: spaceId }, select: { announceSlackChannelId: true } })
  if (!space?.announceSlackChannelId || !(await isSlackChannelPostEnabled())) {
    throw errUnavailable()
  }
}

/** 今すぐ送る。履歴の行(sent)と通知キューへの投入を同じトランザクションで行う */
export const notifyWikiAnnouncementNow = async (actor: Actor, pageId: string, input: WikiAnnounceInput) => {
  const message = normalizeMessage(input.message)
  assertRateLimit(`wiki-announce:${actor.id}`, ANNOUNCE_RATE_LIMIT)
  const { name } = await getUserNameAndTimezone(actor.id)
  const row = await prisma.$transaction(async (tx) => {
    const page = await lockWritableAnnouncement(actor, pageId, tx)
    await assertChannelReady(page.spaceId, tx)
    const now = nowDate()
    const created = await tx.wikiAnnouncementNotify.create({
      data: {
        spaceId: page.spaceId,
        pageId,
        kind: input.kind,
        message,
        scheduledAt: now,
        status: 'sent',
        sentAt: now,
        createdById: actor.id,
      },
      select: NOTIFY_SELECT,
    })
    const payload = payloadOf(page, { kind: input.kind, message }, name)
    if (!(await enqueueNotify({ event: 'wiki_announcement', actorId: actor.id, payload }, tx))) {
      throw errTooManyRequests()
    }
    return created
  })
  logger.info({ userId: actor.id, pageId, kind: input.kind }, 'wiki announcement notified')
  return row
}

/** 日時を指定して予約する */
export const scheduleWikiAnnouncement = async (actor: Actor, pageId: string, input: WikiAnnounceScheduleInput) => {
  const message = normalizeMessage(input.message)
  assertSchedule(input.scheduledAt)
  assertRateLimit(`wiki-announce:${actor.id}`, ANNOUNCE_RATE_LIMIT)
  const row = await prisma.$transaction(async (tx) => {
    const page = await lockWritableAnnouncement(actor, pageId, tx)
    await assertChannelReady(page.spaceId, tx)
    const scheduled = await tx.wikiAnnouncementNotify.count({ where: { pageId, status: 'scheduled' } })
    if (scheduled >= MAX_WIKI_ANNOUNCE_SCHEDULED_PER_PAGE) {
      throw errTooManyScheduled()
    }
    return tx.wikiAnnouncementNotify.create({
      data: {
        spaceId: page.spaceId,
        pageId,
        kind: input.kind,
        message,
        scheduledAt: input.scheduledAt,
        status: 'scheduled',
        createdById: actor.id,
      },
      select: NOTIFY_SELECT,
    })
  })
  logger.info({ userId: actor.id, pageId, id: row.id }, 'wiki announcement scheduled')
  return row
}

/** 予約中の通知の対象ページ。無ければ(別のページ・消えた行)弾く */
const scheduledPageIdOf = async (notifyId: string, tx: Db) => {
  const row = await tx.wikiAnnouncementNotify.findUnique({ where: { id: notifyId }, select: { pageId: true } })
  if (!row) {
    throw errInvalidOperation()
  }
  return row.pageId
}

/**
 * 予約の内容と日時を変える。変えた人が送信者になる(送る時点の権限もその人で確かめる)。
 * ワーカーが送っている最中の行は行ロックを待ってから status を見直すので、送信済みなら弾く
 */
export const updateScheduledWikiAnnouncement = async (
  actor: Actor,
  notifyId: string,
  input: WikiAnnounceScheduleInput,
) => {
  const message = normalizeMessage(input.message)
  assertSchedule(input.scheduledAt)
  assertRateLimit(`wiki-announce:${actor.id}`, ANNOUNCE_RATE_LIMIT)
  await prisma.$transaction(async (tx) => {
    const page = await lockWritableAnnouncement(actor, await scheduledPageIdOf(notifyId, tx), tx)
    await assertChannelReady(page.spaceId, tx)
    const { count } = await tx.wikiAnnouncementNotify.updateMany({
      where: { id: notifyId, status: 'scheduled' },
      data: { kind: input.kind, message, scheduledAt: input.scheduledAt, createdById: actor.id },
    })
    if (count === 0) {
      throw errNotScheduled()
    }
  })
  logger.info({ userId: actor.id, id: notifyId }, 'wiki announcement schedule updated')
}

/** 予約を取り消す。チャンネルが未設定になっていても取り消せる */
export const cancelScheduledWikiAnnouncement = async (actor: Actor, notifyId: string) => {
  await prisma.$transaction(async (tx) => {
    await lockWritableAnnouncement(actor, await scheduledPageIdOf(notifyId, tx), tx)
    const { count } = await tx.wikiAnnouncementNotify.updateMany({
      where: { id: notifyId, status: 'scheduled' },
      data: { status: 'canceled' },
    })
    if (count === 0) {
      throw errNotScheduled()
    }
  })
  logger.info({ userId: actor.id, id: notifyId }, 'wiki announcement schedule canceled')
}

/**
 * ページの通知の履歴(新しい順)と、送れる状態か。editor 以上だけが見られる。
 * アーカイブ済みでも履歴は見られる(送る・変えるは canWrite で画面が閉じる)
 */
export const getWikiAnnouncementNotifies = async (actor: Actor, pageId: string) => {
  const page = await prisma.wikiPage.findUnique({ where: { id: pageId }, select: { spaceId: true } })
  if (!page) {
    throw errInvalidOperation()
  }
  const access = await assertWikiSpaceAccess(actor, page.spaceId, 'view')
  if (access.type !== 'announcement' || !canSeeWikiAnnounce(access.role)) {
    throw errInvalidOperation()
  }
  const [items, space, slackEnabled] = await Promise.all([
    prisma.wikiAnnouncementNotify.findMany({
      where: { pageId },
      select: NOTIFY_SELECT,
      orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
      take: MAX_HISTORY,
    }),
    prisma.wikiSpace.findUnique({ where: { id: page.spaceId }, select: { announceSlackChannelId: true } }),
    isSlackChannelPostEnabled(),
  ])
  return {
    items: items.map(({ createdBy, ...item }) => ({ ...item, createdByName: createdBy?.name ?? '' })),
    /** 通知先のチャンネルが設定済みで、Slack 連携が有効 */
    available: !!space?.announceSlackChannelId && slackEnabled,
    canWrite: access.canWrite,
  }
}

export type WikiAnnouncementNotifyItem = Awaited<ReturnType<typeof getWikiAnnouncementNotifies>>['items'][number]

/**
 * ページの削除と同じトランザクションで、予約中の通知を見送りにする。
 * 復元しても予約は戻さない(消した時点で知らせる意思は無くなったとみなす)
 */
export const skipScheduledWikiAnnouncementsOf = async (tx: Db, pageIds: readonly string[]) => {
  await tx.wikiAnnouncementNotify.updateMany({
    where: { pageId: { in: [...pageIds] }, status: 'scheduled' },
    data: { status: 'skipped', skipReason: 'page_deleted' },
  })
}

type ScheduledOutcome = 'sent' | 'skipped' | 'gone'

/** 予約 1 件を、送信時点のページ・スペース・送信者で確かめてから送る(または見送る) */
const sendScheduled = async (tx: Db, notifyId: string, now: Date): Promise<ScheduledOutcome> => {
  // 期限が来ていて、まだ予約中の行だけを取る。他の周・利用者の変更が持っている行は飛ばす
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "wiki_announcement_notify"
    WHERE "id" = ${notifyId} AND "status" = 'scheduled' AND "scheduledAt" <= ${now}
    FOR UPDATE SKIP LOCKED
  `
  if (locked.length === 0) {
    return 'gone'
  }
  const row = await tx.wikiAnnouncementNotify.findUniqueOrThrow({
    where: { id: notifyId },
    select: {
      spaceId: true,
      pageId: true,
      kind: true,
      message: true,
      createdBy: { select: { id: true, role: true, name: true, banned: true } },
    },
  })
  const skip = async (skipReason: WikiAnnouncementNotifySkipReason): Promise<ScheduledOutcome> => {
    await tx.wikiAnnouncementNotify.update({
      where: { id: notifyId },
      data: { status: 'skipped', skipReason },
      select: { id: true },
    })
    logger.info({ id: notifyId, skipReason }, 'wiki announcement skipped')
    return 'skipped'
  }

  const page = await tx.wikiPage.findUnique({ where: { id: row.pageId }, select: PAYLOAD_PAGE_SELECT })
  if (!page || page.spaceId !== row.spaceId) {
    return skip('page_deleted')
  }
  const space = await tx.wikiSpace.findUniqueOrThrow({
    where: { id: row.spaceId },
    select: { type: true, archived: true, announceSlackChannelId: true },
  })
  if (space.archived) {
    return skip('archived')
  }
  if (space.type !== 'announcement') {
    return skip('not_announcement')
  }
  if (!space.announceSlackChannelId) {
    return skip('channel_unset')
  }
  if (!(await isSlackChannelPostEnabled())) {
    return skip('slack_disabled')
  }
  const sender = row.createdBy
  if (!sender || sender.banned || !(await getWikiSpaceAccess(sender, row.spaceId, tx))?.canWrite) {
    return skip('no_permission')
  }

  const payload = payloadOf(page, row, sender.name)
  if (!(await enqueueNotify({ event: 'wiki_announcement', actorId: sender.id, payload }, tx))) {
    throw new AnnounceThrottled()
  }
  await tx.wikiAnnouncementNotify.update({
    where: { id: notifyId },
    data: { status: 'sent', sentAt: now },
    select: { id: true },
  })
  return 'sent'
}

/**
 * 期限の来た予約を送る(ワーカーの 1 周)。戻り値は送った件数。
 *
 * 1 件ずつトランザクションを分け、1 件の失敗で残りを止めない。流量制限で投入できなかったときは
 * 予約のまま残して周を打ち切り、次の周で送り直す
 */
export const runWikiAnnouncementSchedule = async (now: Date = nowDate()): Promise<number> => {
  const due = await prisma.wikiAnnouncementNotify.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: now } },
    select: { id: true },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take: WIKI_ANNOUNCE_BATCH,
  })
  let sent = 0
  for (const { id } of due) {
    try {
      if ((await prisma.$transaction((tx) => sendScheduled(tx, id, now))) === 'sent') {
        sent++
      }
    } catch (error) {
      if (error instanceof AnnounceThrottled) {
        break
      }
      logger.warn({ error, id }, 'wiki announcement send failed')
    }
  }
  if (sent > 0) {
    logger.info({ sent, candidates: due.length }, 'wiki announcement schedule sent')
  }
  return sent
}
