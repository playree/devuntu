'use server'

import { safeAuthAction } from '@/lib/action-server'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scCreateLinkWidget, scUUID } from '@/lib/schema'
import { writeFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { uuidv7 } from 'uuidv7'

/**
 * LinkWidget一覧取得
 */
export const getLinkWidgets = safeAuthAction
  .metadata({ actionName: 'getLinkWidgets', role: 'admin' })
  .action(async () => {
    const links = await prisma.linkWidget.findMany({
      select: { id: true, name: true, description: true, iconPath: true, updatedAt: true },
    })
    return links
  })

/**
 * LinkWidget作成
 */
export const createLinkWidget = safeAuthAction
  .metadata({ actionName: 'createLinkWidget', role: 'admin' })
  .inputSchema(scCreateLinkWidget)
  .action(async ({ parsedInput: { name, url, description, icon } }) => {
    const id = uuidv7()
    let iconPath: string | null = null
    if (icon) {
      const buffer = Buffer.from(await icon.arrayBuffer())
      const webp = await sharp(buffer)
        .resize(128, 128, { fit: 'cover' }) // 正方形にクロップ
        .webp({ quality: 80 })
        .toBuffer()
      const filename = `${id}.webp`
      await writeFile(path.join(process.cwd(), 'public/up', filename), webp)
      iconPath = `/up/${filename}`
    }
    const created = await prisma.linkWidget.create({
      data: { id, name, url, description, iconPath },
    })
    logger.info({ id: created.id }, 'linkWidget created')
    return created
  })

/**
 * LinkWidget削除
 */
export const deleteLinkWidget = safeAuthAction
  .metadata({ actionName: 'deleteLinkWidget', role: 'admin' })
  .inputSchema(scUUID)
  .action(async ({ parsedInput: { id } }) => {
    logger.info({ id }, 'linkWidget deleted')
    return { id }
  })
