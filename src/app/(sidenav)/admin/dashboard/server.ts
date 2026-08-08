'use server'

import { WidgetDefaultLayout } from '@/components/dashboard/widget-define'
import { LinkWidgetUpdateInput } from '@/generated/prisma/models'
import { safeAuthAction } from '@/lib/action-server'
import { toWebp, WEBP_EXT, WEBP_MIME } from '@/lib/image'
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
import { deleteObject, putObject } from '@/lib/storage'
import { newUploadKey, toUploadKey, toUploadUrl } from '@/lib/upload'
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
 * アイコン画像を正方形にクロップしてwebpでオブジェクトストレージに保存し、公開パスを返す
 */
const saveLinkWidgetIcon = async (icon: File, userId: string) => {
  const webp = await toWebp(icon, { size: 128, fit: 'cover' }) // 正方形にクロップ
  // キャッシュバスティング: 保存ごとにユニークなキーにしてURLを変え、更新を反映させる
  const key = newUploadKey(WEBP_EXT)
  await putObject(key, webp, WEBP_MIME)
  await prisma.attachment.create({
    data: { key, mimeType: WEBP_MIME, size: webp.byteLength, originalName: icon.name, createdById: userId },
  })
  return toUploadUrl(key)
}

/**
 * 保存済みのアイコン画像を削除する
 */
const removeLinkWidgetIcon = async (iconPath: string): Promise<void> => {
  // iconPathは`/api/upload/<key>`形式なのでキーを抽出
  const key = toUploadKey(iconPath)
  try {
    await deleteObject(key)
    // レコードが無いキーもありうるためdeleteManyで許容する
    await prisma.attachment.deleteMany({ where: { key } })
  } catch (err) {
    logger.warn({ err, iconPath }, 'failed to remove linkWidget icon')
  }
}

/**
 * LinkWidget作成
 */
export const createLinkWidget = safeAuthAction
  .metadata({ actionName: 'createLinkWidget', role: 'admin' })
  .inputSchema(scCreateLinkWidget)
  .action(async ({ ctx: { user }, parsedInput: { name, url, description, icon } }) => {
    const id = uuidv7()
    const iconPath = icon ? await saveLinkWidgetIcon(icon, user.id) : null
    const created = await prisma.linkWidget.create({
      data: { id, name, url, description, iconPath },
    })
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
    if (icon !== undefined) {
      const existing = await prisma.linkWidget.findUnique({
        where: { id },
        select: { iconPath: true },
      })
      if (icon === null) {
        // アイコン削除: 既存ファイルを削除してパスをクリア
        if (existing?.iconPath) {
          await removeLinkWidgetIcon(existing.iconPath)
        }
        data.iconPath = null
      } else {
        // アイコン差し替え: 新しいキーで保存してから旧ファイルを削除
        data.iconPath = await saveLinkWidgetIcon(icon, user.id)
        if (existing?.iconPath) {
          await removeLinkWidgetIcon(existing.iconPath)
        }
      }
    }
    const updated = await prisma.linkWidget.update({ where: { id }, data })
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
      await removeLinkWidgetIcon(deleted.iconPath)
    }
    logger.info({ deleted }, 'linkWidget deleted')
    return deleted
  })
