'use server'

import { safeAuthAction } from '@/lib/action-server'
import { errInvalidOperation, errPermissionDenied } from '@/lib/error'
import { canUseGoogleAccount, googleAccountQuery } from '@/lib/google/google-account'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  scCalendarShareOptions,
  scCreateBusyTime,
  scUpdateBusyTime,
  scUpdateCalendarShareTitle,
  scUUID,
} from '@/lib/schema'
import { nanoid } from 'nanoid'

/** 連携が利用不可なら例外を投げる(ミューテーション用ガード) */
const assertGoogleAccountAvailable = async (userId: string) => {
  if (!(await canUseGoogleAccount(userId))) {
    throw errPermissionDenied()
  }
}

/** 公開URL用のID(推測困難な長め) */
const genPublicId = () => nanoid(48)

/** options(JSON)を型付き構造にパース */
const parseOptions = (v: unknown) => scCalendarShareOptions.safeParse(v).data ?? {}

/**
 * カレンダー共有の状態取得
 */
export const getCalendarShare = safeAuthAction
  .metadata({ actionName: 'getCalendarShare', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    // 連携が利用不可なら未連携・未共有として返す
    if (!(await canUseGoogleAccount(user.id))) {
      return { googleConnected: false, shared: false, publicId: null, title: '' }
    }
    const [account, share] = await Promise.all([
      prisma.account.findFirst({
        ...googleAccountQuery(user.id),
        select: { id: true },
      }),
      prisma.calendarShare.findUnique({
        where: { userId: user.id },
        select: { publicId: true, options: true },
      }),
    ])
    return {
      googleConnected: !!account,
      shared: !!share,
      publicId: share?.publicId ?? null,
      title: parseOptions(share?.options).title ?? '',
    }
  })
export type GetCalendarShareReturnType = Awaited<ReturnType<typeof getCalendarShare>>['data']

/**
 * カレンダー共有を有効化(レコード作成)
 */
export const enableCalendarShare = safeAuthAction
  .metadata({ actionName: 'enableCalendarShare', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await assertGoogleAccountAvailable(user.id)
    const share = await prisma.calendarShare.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        publicId: genPublicId(),
        options: { title: `${user.name ?? ''} の予定表` },
      },
      select: { publicId: true },
    })
    logger.info({ userId: user.id }, 'calendar share enabled')
    return { publicId: share.publicId }
  })

/**
 * 共有タイトルを更新(options.title を更新し他のキーは保持)
 */
export const updateCalendarShareTitle = safeAuthAction
  .metadata({ actionName: 'updateCalendarShareTitle', role: 'user' })
  .inputSchema(scUpdateCalendarShareTitle)
  .action(async ({ ctx: { user }, parsedInput: { title } }) => {
    await assertGoogleAccountAvailable(user.id)
    const current = await prisma.calendarShare.findUnique({
      where: { userId: user.id },
      select: { options: true },
    })
    await prisma.calendarShare.update({
      where: { userId: user.id },
      data: { options: { ...parseOptions(current?.options), title } },
    })
    logger.info({ userId: user.id }, 'calendar share title updated')
    return { title }
  })

/**
 * カレンダー共有を無効化(レコード削除)
 */
export const disableCalendarShare = safeAuthAction
  .metadata({ actionName: 'disableCalendarShare', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await assertGoogleAccountAvailable(user.id)
    await prisma.calendarShare.deleteMany({ where: { userId: user.id } })
    logger.info({ userId: user.id }, 'calendar share disabled')
    return { disabled: true }
  })

/**
 * 共有URLの再発行(publicId をローテート)
 */
export const rotateCalendarShareUrl = safeAuthAction
  .metadata({ actionName: 'rotateCalendarShareUrl', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await assertGoogleAccountAvailable(user.id)
    const share = await prisma.calendarShare.update({
      where: { userId: user.id },
      data: { publicId: genPublicId() },
      select: { publicId: true },
    })
    logger.info({ userId: user.id }, 'calendar share url rotated')
    return { publicId: share.publicId }
  })

/**
 * 追加Busy時間の一覧取得
 */
export const getBusyTimes = safeAuthAction
  .metadata({ actionName: 'getBusyTimes', role: 'user' })
  .action(async ({ ctx: { user } }) => {
    await assertGoogleAccountAvailable(user.id)
    return prisma.calendarBusyTime.findMany({
      where: { userId: user.id },
      select: { id: true, title: true, weekdays: true, startMin: true, endMin: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  })
export type GetBusyTimesReturnType = Awaited<ReturnType<typeof getBusyTimes>>['data']

/**
 * 追加Busy時間の作成
 */
export const createBusyTime = safeAuthAction
  .metadata({ actionName: 'createBusyTime', role: 'user' })
  .inputSchema(scCreateBusyTime)
  .action(async ({ ctx: { user }, parsedInput: { title, weekdays, startMin, endMin } }) => {
    await assertGoogleAccountAvailable(user.id)
    const busyTime = await prisma.calendarBusyTime.create({
      data: { userId: user.id, title, weekdays, startMin, endMin },
      select: { id: true },
    })
    logger.info({ userId: user.id, id: busyTime.id }, 'calendar busy time created')
    return busyTime
  })

/**
 * 追加Busy時間の更新
 */
export const updateBusyTime = safeAuthAction
  .metadata({ actionName: 'updateBusyTime', role: 'user' })
  .inputSchema(scUpdateBusyTime)
  .action(async ({ ctx: { user }, parsedInput: { id, title, weekdays, startMin, endMin } }) => {
    await assertGoogleAccountAvailable(user.id)
    const busyTime = await prisma.$transaction(async (tx) => {
      // 所有者確認
      const target = await tx.calendarBusyTime.findFirst({ where: { id, userId: user.id }, select: { id: true } })
      if (!target) {
        throw errInvalidOperation()
      }
      return tx.calendarBusyTime.update({
        where: { id },
        data: { title, weekdays, startMin, endMin },
        select: { id: true },
      })
    })
    logger.info({ userId: user.id, id }, 'calendar busy time updated')
    return busyTime
  })

/**
 * 追加Busy時間の削除
 */
export const deleteBusyTime = safeAuthAction
  .metadata({ actionName: 'deleteBusyTime', role: 'user' })
  .inputSchema(scUUID)
  .action(async ({ ctx: { user }, parsedInput: { id } }) => {
    await assertGoogleAccountAvailable(user.id)
    await prisma.$transaction(async (tx) => {
      // 所有者確認
      const target = await tx.calendarBusyTime.findFirst({ where: { id, userId: user.id }, select: { id: true } })
      if (!target) {
        throw errInvalidOperation()
      }
      await tx.calendarBusyTime.delete({ where: { id } })
    })
    logger.info({ userId: user.id, id }, 'calendar busy time deleted')
    return { id }
  })
