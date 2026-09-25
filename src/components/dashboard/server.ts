'use server'

import { safeAuthAction } from '@/lib/action/action-server'
import { canUseAgentWidgets, listPendingApprovalTickets, listRecentAgentRuns } from '@/lib/agent/agent-widget'
import { listMentions, listRecentActivity } from '@/lib/board/activity-widget'
import { countMyTicketsByStatus, listDueSoonTickets, listMyTickets } from '@/lib/board/ticket-widget'
import { canUseAnyCommand } from '@/lib/command/command-access'
import { listMyRecentCommandRuns } from '@/lib/command/command-widget'
import { envu } from '@/lib/env-util'
import { errCommunication } from '@/lib/error'
import { getString } from '@/lib/kvs'
import { prisma } from '@/lib/prisma'
import os from 'os'
import pkg from '../../../package.json'

/**
 * その他Widget一覧取得(ダッシュボード表示用)
 */
export const getOtherWidgets = safeAuthAction
  .metadata({ actionName: 'getOtherWidgets', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    const [linkWidgets, enabledAgentWidgets, enabledCommandRuns] = await Promise.all([
      prisma.linkWidget.findMany({
        select: { id: true, name: true, url: true, description: true, iconPath: true },
      }),
      canUseAgentWidgets(user.id),
      canUseAnyCommand(user),
    ])
    return {
      linkWidgets,
      enabledLinodeTransferInfo: !!(
        (envu.server.LINODE_ID && envu.server.LINODE_PERSONAL_ACCESS_TOKEN) ||
        envu.server.DEBUG_LINODE_DUMMY
      ),
      enabledAgentWidgets,
      enabledCommandRuns,
    }
  })
export type GetOtherWidgetsReturnType = Awaited<ReturnType<typeof getOtherWidgets>>['data']

/**
 * お知らせ取得(ダッシュボード表示用)
 */
export const getAnnouncement = safeAuthAction
  .metadata({ actionName: 'getAnnouncement', role: 'user' })
  .action(async () => {
    const record = await getString('DASHBOARD_ANNOUNCEMENT')
    return { body: record?.value ?? '' }
  })
export type GetAnnouncementReturnType = Awaited<ReturnType<typeof getAnnouncement>>['data']

/**
 * アプリ情報取得
 */
export const getAppInfo = safeAuthAction.metadata({ actionName: 'getAppInfo', role: 'user' }).action(async () => {
  return {
    version: pkg.version,
    buildno: envu.server.BUILD_NO,
  }
})
export type GetAppInfoReturnType = Awaited<ReturnType<typeof getAppInfo>>['data']

/**
 * サーバー情報取得
 */
export const getServerInfo = safeAuthAction.metadata({ actionName: 'getServerInfo', role: 'user' }).action(async () => {
  return {
    memory: { total: os.totalmem(), free: os.freemem() },
    uptime: os.uptime(),
  }
})
export type GetServerInfoReturnType = Awaited<ReturnType<typeof getServerInfo>>['data']

/**
 * リリースノート取得(GitHub)
 */
export const getReleaseNotes = safeAuthAction
  .metadata({ actionName: 'getReleaseNotes', role: 'user' })
  .action(async () => {
    const res = await fetch(
      `https://api.github.com/repos/${envu.server.RELEASE_NOTES_REPO}/releases?per_page=${envu.server.RELEASE_NOTES_LIMIT}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        next: {
          revalidate: 180,
        },
      },
    )
    if (!res.ok) {
      return []
    }
    const json = (await res.json()) as { id: number; name: string; body: string }[]
    return json.map(({ id, name, body }) => ({ id: String(id), name, body }))
  })
export type GetReleaseNotesReturnType = Awaited<ReturnType<typeof getReleaseNotes>>['data']

/**
 * Linode Transfer情報取得
 */
export const getLinodeTransferInfo = safeAuthAction
  .metadata({ actionName: 'getLinodeTransferInfo', role: 'user' })
  .action(async () => {
    const dummy = envu.server.DEBUG_LINODE_DUMMY
    if (dummy) {
      return {
        ...dummy,
        total: dummy.quota * Math.pow(1024, 3),
      }
    }

    const linodeId = envu.server.LINODE_ID
    const personalAccessToken = envu.server.LINODE_PERSONAL_ACCESS_TOKEN
    if (!linodeId || !personalAccessToken) {
      return null
    }

    try {
      const res = await fetch(`https://api.linode.com/v4/linode/instances/${linodeId}/transfer`, {
        headers: {
          Authorization: `Bearer ${personalAccessToken}`,
        },
        next: {
          revalidate: 180,
        },
      })
      if (!res.ok) {
        throw errCommunication('Linode Transfer')
      }
      const info: {
        used: number
        quota: number
        billable: number
      } = await res.json()
      return {
        ...info,
        total: info.quota * Math.pow(1024, 3),
      }
    } catch {
      throw errCommunication('Linode Transfer')
    }
  })
export type GetLinodeTransferInfoReturnType = Awaited<ReturnType<typeof getLinodeTransferInfo>>['data']

/**
 * 自分の担当チケット取得(未完了・優先度順)
 */
export const getMyTickets = safeAuthAction
  .metadata({ actionName: 'getMyTickets', role: 'user' })
  .action(async ({ ctx: { user } }) => listMyTickets(user.id))
export type GetMyTicketsReturnType = Awaited<ReturnType<typeof getMyTickets>>['data']

/**
 * 期限切れ・期限間近の担当チケット取得
 */
export const getDueSoonTickets = safeAuthAction
  .metadata({ actionName: 'getDueSoonTickets', role: 'user' })
  .action(async ({ ctx: { user } }) => listDueSoonTickets(user.id, user.timezone ?? envu.server.DEFAULT_TIMEZONE))
export type GetDueSoonTicketsReturnType = Awaited<ReturnType<typeof getDueSoonTickets>>['data']

/**
 * 担当チケットのステータス別件数取得
 */
export const getTicketSummary = safeAuthAction
  .metadata({ actionName: 'getTicketSummary', role: 'user' })
  .action(async ({ ctx: { user } }) => ({ counts: await countMyTicketsByStatus(user.id), selfUserId: user.id }))
export type GetTicketSummaryReturnType = Awaited<ReturnType<typeof getTicketSummary>>['data']

/**
 * 自分宛てのメンション(チケット本文・コメント)取得
 */
export const getMentions = safeAuthAction
  .metadata({ actionName: 'getMentions', role: 'user' })
  .action(async ({ ctx: { user } }) => listMentions(user.id))
export type GetMentionsReturnType = Awaited<ReturnType<typeof getMentions>>['data']

/**
 * アクセスできるボードの最近更新されたチケット取得
 */
export const getRecentActivity = safeAuthAction
  .metadata({ actionName: 'getRecentActivity', role: 'user' })
  .action(async ({ ctx: { user } }) => listRecentActivity(user.id))
export type GetRecentActivityReturnType = Awaited<ReturnType<typeof getRecentActivity>>['data']

/**
 * 承認者になっているエージェントの承認待ちチケット取得
 */
export const getAgentApprovals = safeAuthAction
  .metadata({ actionName: 'getAgentApprovals', role: 'user' })
  .action(async ({ ctx: { user } }) => listPendingApprovalTickets(user.id))
export type GetAgentApprovalsReturnType = Awaited<ReturnType<typeof getAgentApprovals>>['data']

/**
 * 承認者になっているエージェントの最近の実行取得
 */
export const getRecentAgentRuns = safeAuthAction
  .metadata({ actionName: 'getRecentAgentRuns', role: 'user' })
  .action(async ({ ctx: { user } }) => listRecentAgentRuns(user.id))
export type GetRecentAgentRunsReturnType = Awaited<ReturnType<typeof getRecentAgentRuns>>['data']

/**
 * 自分が実行した最近のリモート実行取得
 */
export const getRecentCommandRuns = safeAuthAction
  .metadata({ actionName: 'getRecentCommandRuns', role: 'user' })
  .action(async ({ ctx: { user } }) => listMyRecentCommandRuns(user))
export type GetRecentCommandRunsReturnType = Awaited<ReturnType<typeof getRecentCommandRuns>>['data']
