'use server'

import { LinkWidgetUpdateInput } from '@/generated/prisma/models'
import { safeAuthAction } from '@/lib/action-server'
import { getString, setString } from '@/lib/kvs'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  scCreateLinkWidget,
  scDashboardLayout,
  scUpdateDashboard,
  scUpdateLinkWidget,
  scUUID,
  WidgetDefaultLayout,
} from '@/lib/schema'
import { unlink, writeFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { uuidv7 } from 'uuidv7'

const DASHBOARD_DEFAULT_LAYOUT_KEY = 'DASHBOARD_DEFAULT_LAYOUT' as const

/**
 * デフォルトダッシュボードレイアウト取得
 * 未設定・パース不可の場合はハードコードされた既定値を返す
 */
export const getDefaultDashboard = safeAuthAction
  .metadata({ actionName: 'getDefaultDashboard', role: 'admin' })
  .action(async () => {
    const record = await getString(DASHBOARD_DEFAULT_LAYOUT_KEY)
    if (record?.value) {
      try {
        const parsed = scDashboardLayout.safeParse(JSON.parse(record.value))
        if (parsed.success) {
          return parsed.data
        }
      } catch {}
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
    await setString(DASHBOARD_DEFAULT_LAYOUT_KEY, JSON.stringify(layout))
    logger.info({ layout }, 'default dashboard layout updated')
    return { layout }
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
 * アイコン画像を正方形にクロップしてwebpで保存し、公開パスを返す
 */
const saveLinkWidgetIcon = async (icon: File, id: string) => {
  const buffer = Buffer.from(await icon.arrayBuffer())
  const webp = await sharp(buffer)
    .resize(128, 128, { fit: 'cover' }) // 正方形にクロップ
    .webp({ quality: 80 })
    .toBuffer()
  // キャッシュバスティング: 保存ごとにユニークなファイル名にしてURLを変え、更新を反映させる
  const filename = `${id}-${Date.now().toString(36)}.webp`
  await writeFile(path.join(process.cwd(), 'public/up', filename), webp)
  return `/up/${filename}`
}

/**
 * 保存済みのアイコン画像を削除する
 */
const removeLinkWidgetIcon = async (iconPath: string): Promise<void> => {
  await unlink(path.join(process.cwd(), 'public', iconPath)).catch(() => {})
}

/**
 * LinkWidget作成
 */
export const createLinkWidget = safeAuthAction
  .metadata({ actionName: 'createLinkWidget', role: 'admin' })
  .inputSchema(scCreateLinkWidget)
  .action(async ({ parsedInput: { name, url, description, icon } }) => {
    const id = uuidv7()
    const iconPath = icon ? await saveLinkWidgetIcon(icon, id) : null
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
  .action(async ({ parsedInput: { id, name, url, description, icon } }) => {
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
        // アイコン差し替え: 新ファイル名で保存してから旧ファイルを削除
        data.iconPath = await saveLinkWidgetIcon(icon, id)
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
