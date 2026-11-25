/**
 * Wiki スペースの作成・更新・一覧(サーバー専用)
 *
 * スペースはログインユーザーなら誰でも作れ、作成者が owner になる。
 * 設定の変更(名前・説明・公開範囲・アーカイブ)と削除は owner と管理者。
 * 区分(type)は作成時に決め、後から変えない(作れるページの種類・ページの置き方が区分で決まるため)。
 */

import type { WikiSpaceType, WikiVisibility } from '@/generated/prisma/enums'
import { isAdminActor, type Actor } from '../board/board-access'
import { ClientError, errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import { isUniqueViolation, prisma } from '../prisma'
import { listSlackChannels } from '../slack/slack-server'
import { detachAttachmentsOf, listAttachmentKeysOf, removeAttachmentByKey } from '../storage/attachment'
import {
  assertWikiSpaceAccess,
  getWikiSpaceAccess,
  roleOfWikiRow,
  wikiRoleSelect,
  wikiSpaceListWhere,
} from './wiki-access'
import {
  DUPLICATED_WIKI_SPACE_KEY,
  evaluateWikiAccess,
  MAX_WIKI_SPACE_DESCRIPTION,
  MAX_WIKI_SPACE_NAME,
  WIKI_SPACE_KEY_PATTERN,
} from './wiki-rule'

export type WikiSpaceInput = {
  key: string
  name: string
  description?: string | null
  visibility?: WikiVisibility
  /** 区分。作成時だけ指定でき、後から変えない */
  type?: WikiSpaceType
}

const errDuplicatedKey = () =>
  new ClientError(
    DUPLICATED_WIKI_SPACE_KEY,
    'This key is already used by a wiki space (including deleted ones). Choose another key',
  )
const assertName = (name: string) => {
  if (name.trim() === '' || name.length > MAX_WIKI_SPACE_NAME) {
    throw errValidation(`name must be 1 to ${MAX_WIKI_SPACE_NAME} characters`)
  }
}

const assertDescription = (description: string | null | undefined) => {
  if (description && description.length > MAX_WIKI_SPACE_DESCRIPTION) {
    throw errValidation(`description must be at most ${MAX_WIKI_SPACE_DESCRIPTION} characters`)
  }
}

const SPACE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  visibility: true,
  type: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
} as const

/**
 * スペースを作り、作成者を owner として割り当てる。
 * キーは履歴(WikiSpaceKeyHistory)へ登録して占有する。消したスペースのキーも履歴に残るので、
 * 共有済みの `KEY/番号` が別のスペースのページを指すことはない
 */
export const createWikiSpace = async (actor: Actor, input: WikiSpaceInput) => {
  const key = input.key.trim().toUpperCase()
  if (!WIKI_SPACE_KEY_PATTERN.test(key)) {
    throw errValidation('key must be 2 to 8 uppercase letters or digits starting with a letter')
  }
  assertName(input.name)
  assertDescription(input.description)

  const space = await prisma
    .$transaction(async (tx) => {
      await tx.wikiSpaceKeyHistory.create({ data: { key }, select: { key: true } })
      return tx.wikiSpace.create({
        data: {
          key,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          visibility: input.visibility ?? 'restricted',
          type: input.type ?? 'mixed',
          members: { create: { userId: actor.id, role: 'owner' } },
        },
        select: SPACE_SELECT,
      })
    })
    .catch((e: unknown) => {
      throw isUniqueViolation(e) ? errDuplicatedKey() : e
    })

  logger.info({ userId: actor.id, spaceId: space.id, key }, 'wiki space created')
  return space
}

/** 名前・説明・公開範囲の変更。undefined の項目はそのまま残す。キーと区分は変えられない */
export const updateWikiSpace = async (
  actor: Actor,
  spaceId: string,
  patch: Partial<Omit<WikiSpaceInput, 'key' | 'type'>>,
) => {
  if (patch.name !== undefined) {
    assertName(patch.name)
  }
  assertDescription(patch.description)
  const space = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    return tx.wikiSpace.update({
      where: { id: spaceId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      },
      select: SPACE_SELECT,
    })
  })
  logger.info({ userId: actor.id, spaceId }, 'wiki space updated')
  return space
}

/** アーカイブの切り替え。アーカイブ済みは閲覧のみになる */
export const setWikiSpaceArchived = async (actor: Actor, spaceId: string, archived: boolean) => {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    await tx.wikiSpace.update({ where: { id: spaceId }, data: { archived }, select: { id: true } })
  })
  logger.info({ userId: actor.id, spaceId, archived }, 'wiki space archived changed')
}

/**
 * スペースの削除(owner または管理者)。ページ・版・タグ・割り当ては Cascade で消え、キーは履歴に残る。
 *
 * 添付はボード削除(`deleteBoard`)と同じく、レコードを Cascade に任せず紐付けを外して削除待ちにし、
 * コミット後に実体ごと消す。実体の削除に失敗した分は、回収されるまで配信せず、掃除が回収する。
 * スペースの行ロックを取ってから消すので、ページの書き込み(同じロックを取る)と入れ違わない
 */
export const deleteWikiSpace = async (actor: Actor, spaceId: string) => {
  const keys = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR UPDATE`
    await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    // 紐付けを外すとスペースから辿れなくなるので、キーはここで控える
    const keys = await listAttachmentKeysOf(tx, { wikiSpaceId: spaceId })
    await detachAttachmentsOf(tx, { wikiSpaceId: spaceId })
    await tx.wikiSpace.delete({ where: { id: spaceId }, select: { id: true } })
    return keys
  })

  // ロールバックで実データを失わないよう、コミットしてから実体を消す
  let removed = 0
  for (const key of keys) {
    if (await removeAttachmentByKey(key)) {
      removed += 1
    }
  }

  logger.info({ userId: actor.id, spaceId, attachments: keys.length, removed }, 'wiki space deleted')
}

/**
 * アナウンスの通知先チャンネル(owner または管理者)。
 * Slack のチャンネル一覧はプライベートチャンネル名を含むので、一覧を返す前にこれで権限を確定させる
 */
export const assertWikiAnnounceChannelManageable = async (actor: Actor, spaceId: string) => {
  const access = await assertWikiSpaceAccess(actor, spaceId, 'manage')
  if (access.type !== 'announcement') {
    throw errInvalidOperation()
  }
}

/** アナウンスの通知先チャンネルの現在値(owner または管理者)。未設定は null */
export const getWikiAnnounceChannel = async (actor: Actor, spaceId: string) => {
  await assertWikiAnnounceChannelManageable(actor, spaceId)
  const space = await prisma.wikiSpace.findUniqueOrThrow({
    where: { id: spaceId },
    select: { announceSlackChannelId: true },
  })
  return { slackChannelId: space.announceSlackChannelId }
}

/**
 * アナウンスの通知先チャンネルの設定・解除(owner または管理者)。null で解除する。
 * ボードのチャネル通知と同じく、Bot が参加していないチャンネルを保存すると通知だけ届かなくなるので、
 * 一覧と突き合わせてから保存する(突き合わせの成否がチャンネルの実在を教えないよう、権限の確定を先に済ませる)
 */
export const setWikiAnnounceChannel = async (actor: Actor, spaceId: string, slackChannelId: string | null) => {
  await assertWikiAnnounceChannelManageable(actor, spaceId)
  if (slackChannelId) {
    const channels = await listSlackChannels()
    if (!channels?.some((channel) => channel.id === slackChannelId)) {
      throw errValidation('slackChannelId')
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`
    const access = await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
    if (access.type !== 'announcement') {
      throw errInvalidOperation()
    }
    await tx.wikiSpace.update({
      where: { id: spaceId },
      data: { announceSlackChannelId: slackChannelId },
      select: { id: true },
    })
  })
  logger.info({ userId: actor.id, spaceId, set: !!slackChannelId }, 'wiki announce channel changed')
}

/** 閲覧できるスペースの一覧(名前順)と、それぞれでの自分の権限 */
export const listWikiSpaces = async (actor: Actor, opts?: { includeArchived?: boolean }) => {
  const spaces = await prisma.wikiSpace.findMany({
    where: wikiSpaceListWhere(actor.id, opts),
    select: { ...SPACE_SELECT, ...wikiRoleSelect(actor.id) },
    orderBy: [{ name: 'asc' }, { key: 'asc' }],
  })
  return spaces.map(({ members, groups, boards, ...space }) => {
    const role = roleOfWikiRow({ visibility: space.visibility, members, groups, boards })
    return { ...space, role, ...evaluateWikiAccess({ role, archived: space.archived, isAdmin: isAdminActor(actor) }) }
  })
}

export type WikiSpaceSummary = Awaited<ReturnType<typeof listWikiSpaces>>[number]

/** キーでスペースを引く(`need` の権限が無ければ errInvalidOperation。既定は閲覧) */
export const getWikiSpaceByKey = async (actor: Actor, key: string, need: 'view' | 'write' = 'view') => {
  const space = await prisma.wikiSpace.findUnique({ where: { key: key.toUpperCase() }, select: SPACE_SELECT })
  if (!space) {
    throw errInvalidOperation()
  }
  const access = await assertWikiSpaceAccess(actor, space.id, need)
  return { space, access }
}

/**
 * キーでスペースを引く(閲覧も管理もできなければ errInvalidOperation)。
 * 割り当ての無い管理者は管理だけができ本文は読めないので、本文やツリーを返す前に呼び出し側で canView を見ること
 */
export const getWikiSpaceByKeyForManage = async (actor: Actor, key: string) => {
  const space = await prisma.wikiSpace.findUnique({ where: { key: key.toUpperCase() }, select: SPACE_SELECT })
  const access = space && (await getWikiSpaceAccess(actor, space.id))
  if (!space || !access || (!access.canView && !access.canManage)) {
    throw errInvalidOperation()
  }
  return { space, access }
}

export type BoardWikiSpace = {
  key: string
  name: string
  description?: string
  type: WikiSpaceType
  canWrite: boolean
}

/**
 * ボードに割り当てられたスペースのうち、閲覧できてアーカイブされていないもの(名前順)の索引。
 * MCP の get_ticket / get_board / get_agent_task に展開して載せるので、0 件なら項目ごと返さない
 */
export const findBoardWikiSpaceIndex = async (
  actor: Actor,
  boardId: string,
): Promise<{ wikiSpaces?: BoardWikiSpace[] }> => {
  const spaces = await prisma.wikiSpace.findMany({
    where: { AND: [wikiSpaceListWhere(actor.id), { boards: { some: { boardId } } }] },
    select: { key: true, name: true, description: true, type: true, archived: true, ...wikiRoleSelect(actor.id) },
    orderBy: [{ name: 'asc' }, { key: 'asc' }],
  })
  if (spaces.length === 0) {
    return {}
  }
  return {
    wikiSpaces: spaces.map(({ members, groups, boards, ...space }) => {
      const role = roleOfWikiRow({ visibility: space.visibility, members, groups, boards })
      const { canWrite } = evaluateWikiAccess({ role, archived: space.archived, isAdmin: isAdminActor(actor) })
      return {
        key: space.key,
        name: space.name,
        ...(space.description ? { description: space.description } : {}),
        type: space.type,
        canWrite,
      }
    }),
  }
}
