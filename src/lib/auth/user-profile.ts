/**
 * 利用者本人のプロフィール(タイムゾーン / アバター)の更新(サーバー専用)
 */

import { isValidTimezone } from '../day'
import { errValidation } from '../error'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { removeImageAttachment, saveImageAttachment } from '../storage/attachment'

export const updateUserTimezone = async (userId: string, timezone: string) => {
  if (!isValidTimezone(timezone)) {
    throw errValidation('timezone is not valid')
  }
  await prisma.user.update({ where: { id: userId }, data: { timezone } })
  logger.info({ userId, timezone }, 'user timezone updated')
}

/**
 * アバター更新。
 *
 * 画像を設定している間はログイン時のコピーが走らない。null指定で削除すると、
 * 次回のOIDCログインでIdP側のアバターが改めてコピーされる
 */
export const updateUserAvatar = async (userId: string, image: File | null): Promise<string | null> => {
  const existing = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { image: true } })

  if (image === null) {
    await prisma.user.update({ where: { id: userId }, data: { image: null } })
    if (existing.image) {
      await removeImageAttachment(existing.image)
    }
    logger.info({ userId }, 'user avatar removed')
    return null
  }

  const url = await saveImageAttachment(image, userId)
  try {
    await prisma.user.update({ where: { id: userId }, data: { image: url } })
  } catch (err) {
    // 更新に失敗した場合は新規保存分を残さない
    await removeImageAttachment(url)
    throw err
  }
  if (existing.image) {
    await removeImageAttachment(existing.image)
  }
  logger.info({ userId }, 'user avatar updated')
  return url
}
