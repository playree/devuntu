/**
 * 利用者本人のプロフィール(タイムゾーン / アバター)の参照・更新(サーバー専用)
 */

import { isValidTimezone } from '../day'
import { envu } from '../env-util'
import { errValidation } from '../error'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { removeImageAttachment, removeOwnedImageAttachment, saveImageAttachment } from '../storage/attachment'

/** 表示名とタイムゾーン。タイムゾーンが未設定ならサーバーの既定(`DEFAULT_TIMEZONE`) */
export const getUserNameAndTimezone = async (userId: string): Promise<{ name: string; timezone: string }> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, timezone: true } })
  return { name: user?.name ?? '', timezone: user?.timezone ?? envu.server.DEFAULT_TIMEZONE }
}

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
      await removeOwnedImageAttachment(existing.image, userId)
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
    await removeOwnedImageAttachment(existing.image, userId)
  }
  logger.info({ userId }, 'user avatar updated')
  return url
}
