/**
 * Wiki(スペース / ページ / 割り当て)の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { MAX_TAG_NAME } from '../board/tag-rule'
import {
  MAX_WIKI_CONTENT,
  MAX_WIKI_PAGE_TAGS,
  MAX_WIKI_REVISION_MESSAGE,
  MAX_WIKI_SEARCH_KEYWORD,
  MAX_WIKI_SEARCH_LIMIT,
  MAX_WIKI_SPACE_DESCRIPTION,
  MAX_WIKI_SPACE_KEY,
  MAX_WIKI_SPACE_NAME,
  MAX_WIKI_TITLE,
  WIKI_SPACE_KEY_PATTERN,
} from '../wiki/wiki-rule'
import { zTagColor, zTagName, zTagOrder } from './schema-ticket'

/** スペースキー。形式はボードキーと同じなので、エラー文言も共有する */
export const zWikiSpaceKey = z
  .string()
  .trim()
  .toUpperCase()
  .max(MAX_WIKI_SPACE_KEY, el('@invalid_board_key'))
  .regex(WIKI_SPACE_KEY_PATTERN, el('@invalid_board_key'))

const zWikiSpaceName = z
  .string()
  .trim()
  .min(1, el('@invalid_wiki_space_name'))
  .max(MAX_WIKI_SPACE_NAME, el('@invalid_wiki_space_name'))
const zWikiSpaceDescription = z
  .string()
  .max(MAX_WIKI_SPACE_DESCRIPTION, el('@invalid_wiki_space_description'))
  .optional()
/** Prisma の WikiVisibility と一致させる */
export const zWikiVisibility = z.enum(['restricted', 'everyone'])
/** Prisma の WikiSpaceRole と一致させる */
export const zWikiSpaceRole = z.enum(['viewer', 'editor', 'owner'])
/** Prisma の WikiAssignRole と一致させる */
export const zWikiAssignRole = z.enum(['viewer', 'editor'])
/** Prisma の WikiPageType と一致させる */
export const zWikiPageType = z.enum(['page', 'design_doc'])

const zWikiTitle = z.string().trim().min(1, el('@invalid_wiki_title')).max(MAX_WIKI_TITLE, el('@invalid_wiki_title'))

export const scCreateWikiSpace = z.object({
  key: zWikiSpaceKey,
  name: zWikiSpaceName,
  description: zWikiSpaceDescription,
  visibility: zWikiVisibility,
})
export type CreateWikiSpace = z.infer<typeof scCreateWikiSpace>

/** キーは作成後に変えない(共有済みの `KEY/番号` が別のページを指さないように) */
export const scUpdateWikiSpace = z.object({
  id: z.uuidv7(),
  name: zWikiSpaceName,
  description: zWikiSpaceDescription,
  visibility: zWikiVisibility,
})
export type UpdateWikiSpace = z.infer<typeof scUpdateWikiSpace>

export const scSetWikiSpaceArchived = z.object({
  id: z.uuidv7(),
  archived: z.boolean(),
})

export const scWikiSpaceKey = z.object({ key: zWikiSpaceKey })

export const scGetWikiSpaces = z.object({ includeArchived: z.boolean() })

export const scGetWikiPage = z.object({
  key: zWikiSpaceKey,
  number: z.number().int().positive(),
})

/** `spaceId` 直下(parentId が null)か、親ページの下の末尾に作る */
export const scCreateWikiPage = z.object({
  spaceId: z.uuidv7(),
  parentId: z.uuidv7().nullable(),
  title: zWikiTitle,
  type: zWikiPageType,
})
export type CreateWikiPage = z.infer<typeof scCreateWikiPage>

/** `expectedUpdatedAt` は読み込んだときの updatedAt(ISO)。他の人が先に保存していれば競合にする */
export const scUpdateWikiPage = z.object({
  id: z.uuidv7(),
  title: zWikiTitle,
  content: z.string().max(MAX_WIKI_CONTENT, el('@invalid_content')),
  type: zWikiPageType,
  tagIds: z.array(z.uuidv7()).max(MAX_WIKI_PAGE_TAGS, el('@invalid_tag')),
  expectedUpdatedAt: z.iso.datetime(),
  /** コミットメッセージ(任意) */
  message: z.string().max(MAX_WIKI_REVISION_MESSAGE).optional(),
})
export type UpdateWikiPage = z.infer<typeof scUpdateWikiPage>

/** 同じ親の中での並べ替えも、parentId を変えずに position だけ変えて表す。position は 0 始まりで、省略すると末尾 */
export const scMoveWikiPage = z.object({
  id: z.uuidv7(),
  parentId: z.uuidv7().nullable(),
  position: z.number().int().min(0).optional(),
})
export type MoveWikiPage = z.infer<typeof scMoveWikiPage>

/** 子孫を持つページは recursive が無いと消せない */
export const scDeleteWikiPage = z.object({
  id: z.uuidv7(),
  recursive: z.boolean(),
})

/** ユーザーの直接割り当て。`id` はスペース ID */
export const scUpsertWikiSpaceMember = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  role: zWikiSpaceRole,
})

export const scRemoveWikiSpaceMember = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
})

/** グループ / ボードの割り当て。`id` はスペース ID、`targetId` はグループ ID またはボード ID */
export const scUpsertWikiSpaceTarget = z.object({
  id: z.uuidv7(),
  targetId: z.uuidv7(),
  role: zWikiAssignRole,
})

export const scRemoveWikiSpaceTarget = z.object({
  id: z.uuidv7(),
  targetId: z.uuidv7(),
})

/** タグはスペースに属する。order を省略すると末尾へ採番する */
export const scCreateWikiTag = z.object({
  spaceId: z.uuidv7(),
  name: zTagName,
  color: zTagColor.default('gray'),
  order: zTagOrder.optional(),
})

export const scUpdateWikiTag = z.object({
  id: z.uuidv7(),
  name: zTagName,
  color: zTagColor,
  order: zTagOrder,
})

/** `space` を省略すると、閲覧できる全スペース(アーカイブ済みを除く)を探す */
export const scWikiSearch = z.object({
  keyword: z.string().trim().max(MAX_WIKI_SEARCH_KEYWORD).default(''),
  space: zWikiSpaceKey.optional(),
  tags: z.array(z.string().trim().max(MAX_TAG_NAME)).max(MAX_WIKI_PAGE_TAGS).default([]),
  limit: z.number().int().min(1).max(MAX_WIKI_SEARCH_LIMIT).optional(),
})
export type WikiSearch = z.input<typeof scWikiSearch>
