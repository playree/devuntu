'use server'

import { WidgetDefaultLayout } from '@/components/dashboard/widget-define'
import { LinkWidgetUpdateInput } from '@/generated/prisma/models'
import { safeAuthAction } from '@/lib/action-server'
import { removeImageAttachment, saveImageAttachment } from '@/lib/attachment'
import { getString, setString } from '@/lib/kvs'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  scCreateLinkWidget,
  scDashboardLayout,
  scUpdateAnnouncement,
  scUpdateDashboard,
  scUpdateLinkWidget,
  scUUID,
} from '@/lib/schema'
import { uuidv7 } from 'uuidv7'

/**
 * デフォルトダッシュボードレイアウト取得
 * 未設定・パース不可の場合はハードコードされた既定値を返す
 */
export const getDefaultDashboard = safeAuthAction
  .metadata({ actionName: 'getDefaultDashboard', role: 'admin' })
  .action(async () => {
    const record = await getString('DASHBOARD_DEFAULT_LAYOUT')
    if (record?.value) {
      try {
        const parsed = scDashboardLayout.safeParse(JSON.parse(record.value))
        if (parsed.success) {
          return parsed.data
        }
      } catch {
        // JSON.parseで例外が発生した場合は無視して既定値を返す
      }
      logger.warn({ value: record.value }, 'invalid default dashboard layout, fallback to default')
    }
    return WidgetDefaultLayout
  })

/**
 * デフォルトダッシュボードレイアウト更新
 */
export const updateDefaultDashboard = safeAuthAction
  .metadata({ actionName: 'updateDefaultDashboard', role: 'admin' })
  .inputSchema(scUpdateDashboard)
  .action(async ({ parsedInput: { layout } }) => {
    await setString('DASHBOARD_DEFAULT_LAYOUT', JSON.stringify(layout))
    logger.info({ layout }, 'default dashboard layout updated')
    return { layout }
  })

/**
 * お知らせ取得(管理ページ編集用)
 */
export const getAnnouncement = safeAuthAction
  .metadata({ actionName: 'getAdminAnnouncement', role: 'admin' })
  .action(async () => {
    const record = await getString('DASHBOARD_ANNOUNCEMENT')
    return { body: record?.value ?? '' }
  })

/**
 * お知らせ更新
 */
export const updateAnnouncement = safeAuthAction
  .metadata({ actionName: 'updateAnnouncement', role: 'admin' })
  .inputSchema(scUpdateAnnouncement)
  .action(async ({ parsedInput: { body } }) => {
    await setString('DASHBOARD_ANNOUNCEMENT', body)
    logger.info('announcement updated')
    return { body }
  })

/**
 * LinkWidget一覧取得
 */
export const getLinkWidgets = safeAuthAction
  .metadata({ actionName: 'getLinkWidgets', role: 'admin' })
  .action(async () => {
    const links = await prisma.linkWidget.findMany({
      select: { id: true, name: true, url: true, description: true, iconPath: true, updatedAt: true },
    })
    return links
  })

/**
 * LinkWidget作成
 */
export const createLinkWidget = safeAuthAction
  .metadata({ actionName: 'createLinkWidget', role: 'admin' })
  .inputSchema(scCreateLinkWidget)
  .action(async ({ ctx: { user }, parsedInput: { name, url, description, icon } }) => {
    const id = uuidv7()
    const iconPath = icon ? await saveImageAttachment(icon, user.id) : null
    let created
    try {
      created = await prisma.linkWidget.create({
        data: { id, name, url, description, iconPath },
      })
    } catch (err) {
      // 作成に失敗した場合は新規保存分を残さない
      if (iconPath) {
        await removeImageAttachment(iconPath)
      }
      throw err
    }
    logger.info({ created }, 'linkWidget created')
    return created
  })

/**
 * LinkWidget更新
 */
export const updateLinkWidget = safeAuthAction
  .metadata({ actionName: 'updateLinkWidget', role: 'admin' })
  .inputSchema(scUpdateLinkWidget)
  .action(async ({ ctx: { user }, parsedInput: { id, name, url, description, icon } }) => {
    const data: LinkWidgetUpdateInput = {
      name,
      url,
      description,
    }
    // 旧アイコンはDB更新の成功後にのみ削除する(更新失敗時に新旧両方を失わないため)
    let oldIconPath: string | null = null
    let newIconPath: string | null = null
    if (icon !== undefined) {
      const existing = await prisma.linkWidget.findUnique({
        where: { id },
        select: { iconPath: true },
      })
      oldIconPath = existing?.iconPath ?? null
      if (icon === null) {
        data.iconPath = null
      } else {
        newIconPath = await saveImageAttachment(icon, user.id)
        data.iconPath = newIconPath
      }
    }

    let updated
    try {
      updated = await prisma.linkWidget.update({ where: { id }, data })
    } catch (err) {
      // 更新に失敗した場合は新規保存分を残さない
      if (newIconPath) {
        await removeImageAttachment(newIconPath)
      }
      throw err
    }

    if (oldIconPath) {
      await removeImageAttachment(oldIconPath)
    }
    logger.info({ updated }, 'linkWidget updated')
    return updated
  })

/**
 * LinkWidget削除
 */
export const deleteLinkWidget = safeAuthAction
  .metadata({ actionName: 'deleteLinkWidget', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    const deleted = await prisma.linkWidget.delete({ where: { id } })
    if (deleted.iconPath) {
      await removeImageAttachment(deleted.iconPath)
    }
    logger.info({ deleted }, 'linkWidget deleted')
    return deleted
  })
