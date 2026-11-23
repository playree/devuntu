'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { scUUID } from '@/lib/schema/schema'
import { scGetWikiPage, scUpdateWikiPage, scWikiAnnounceNow, scWikiAnnounceSchedule } from '@/lib/schema/schema-wiki'
import {
  cancelScheduledWikiAnnouncement,
  getWikiAnnouncementNotifies as getWikiAnnouncementNotifiesCore,
  notifyWikiAnnouncementNow,
  scheduleWikiAnnouncement,
  updateScheduledWikiAnnouncement,
} from '@/lib/wiki/wiki-announcement-notify'
import { getWikiPage as getWikiPageCore, updateWikiPage as updateWikiPageCore } from '@/lib/wiki/wiki-page'

/** ページ詳細(パンくず・子ページ付き)。ツリーはサイドメニューが別に持つので返さない */
export const getWikiPage = safeAuthAction
  .metadata({ actionName: 'getWikiPage', role: 'user' })
  .inputSchema(scGetWikiPage)
  .action(async ({ ctx: { user }, parsedInput: { key, number } }) => {
    const { tree: _tree, ...detail } = await getWikiPageCore(user, key, number)
    return detail
  })
export type GetWikiPageReturnType = Awaited<ReturnType<typeof getWikiPage>>['data']

/** タイトル・本文・種類・タグの保存(任意でコミットメッセージ)。読み込んだ後に他の人が保存していれば WIKI_PAGE_CONFLICT */
export const updateWikiPage = safeAuthAction
  .metadata({ actionName: 'updateWikiPage', role: 'user' })
  .inputSchema(scUpdateWikiPage)
  .action(
    async ({ ctx: { user }, parsedInput: { id, title, content, type, tagIds, expectedUpdatedAt, message } }) =>
      await updateWikiPageCore(
        user,
        { via: 'web' },
        id,
        { title, content, type, tagIds },
        { expectedUpdatedAt, message },
      ),
  )

/** アナウンスの通知の履歴と、送れる状態か(`id` はページ ID。editor 以上) */
export const getWikiAnnouncementNotifies = safeAuthAction
  .metadata({ actionName: 'getWikiAnnouncementNotifies', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => await getWikiAnnouncementNotifiesCore(user, id))
export type GetWikiAnnouncementNotifiesReturnType = Awaited<ReturnType<typeof getWikiAnnouncementNotifies>>['data']

/** アナウンスを今すぐ Slack へ通知する(`id` はページ ID) */
export const notifyWikiAnnouncement = safeAuthAction
  .metadata({ actionName: 'notifyWikiAnnouncement', role: 'user' })
  .inputSchema(scWikiAnnounceNow)
  .action(async ({ ctx: { user }, parsedInput: { id, kind, message } }) => {
    await notifyWikiAnnouncementNow(user, id, { kind, message })
    return { id }
  })

/** アナウンスの通知を予約する(`id` はページ ID) */
export const scheduleWikiAnnouncementNotify = safeAuthAction
  .metadata({ actionName: 'scheduleWikiAnnouncementNotify', role: 'user' })
  .inputSchema(scWikiAnnounceSchedule)
  .action(async ({ ctx: { user }, parsedInput: { id, kind, message, scheduledAt } }) => {
    await scheduleWikiAnnouncement(user, id, { kind, message, scheduledAt: new Date(scheduledAt) })
    return { id }
  })

/** 予約中の通知を変える(`id` は通知の ID)。変えた人が送信者になる */
export const updateWikiAnnouncementNotify = safeAuthAction
  .metadata({ actionName: 'updateWikiAnnouncementNotify', role: 'user' })
  .inputSchema(scWikiAnnounceSchedule)
  .action(async ({ ctx: { user }, parsedInput: { id, kind, message, scheduledAt } }) => {
    await updateScheduledWikiAnnouncement(user, id, { kind, message, scheduledAt: new Date(scheduledAt) })
    return { id }
  })

/** 予約中の通知を取り消す(`id` は通知の ID) */
export const cancelWikiAnnouncementNotify = safeAuthAction
  .metadata({ actionName: 'cancelWikiAnnouncementNotify', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await cancelScheduledWikiAnnouncement(user, id)
    return { id }
  })
