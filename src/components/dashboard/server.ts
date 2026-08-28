'use server'

import { safeAuthAction } from '@/lib/action/action-server'
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
  .action(async () => {
    return {
      linkWidgets: await prisma.linkWidget.findMany({
        select: { id: true, name: true, url: true, description: true, iconPath: true },
      }),
      enabledLinodeTransferInfo: !!(
        (envu.server.LINODE_ID && envu.server.LINODE_PERSONAL_ACCESS_TOKEN) ||
        envu.server.DEBUG_LINODE_DUMMY
      ),
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
    const res = await fetch('https://api.github.com/repos/playree/devuntu/releases', {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      next: {
        revalidate: 180,
      },
    })
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
