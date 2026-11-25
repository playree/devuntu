/**
 * Wiki のページテンプレート(サーバー専用)。スペースごとに持ち、どの区分のスペースでも使える
 *
 * - 一覧(本文込み)・追加・編集・削除・並べ替えは manage、かつアーカイブされていないこと(タグの更新・削除と同じ)
 * - ページ作成で使う(選択肢・置き換えた内容を引く)のは write
 * - 種類はスペースの区分で作れるもの(`isWikiPageTypeAllowed`)に限る(区分は作成後に変わらない)
 * 純粋関数と定数は `wiki-template-rule.ts` を参照。
 */

import type { WikiPageType } from '@/generated/prisma/enums'
import { getUserNameAndTimezone } from '../auth/user-profile'
import type { Actor } from '../board/board-access'
import { errDuplicatedTemplateName } from '../board/ticket-template-rule'
import { ClientError, errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import { prisma, rethrowUniqueViolation, type Db } from '../prisma'
import type { CreateWikiTemplate, UpdateWikiTemplate } from '../schema/schema-wiki'
import { assertWikiSpaceAccess, type WikiSpaceAccess } from './wiki-access'
import { hasDesignDocFrontMatter } from './wiki-front-matter'
import { lockWikiSpace } from './wiki-lock'
import {
  isWikiPageTypeAllowed,
  MAX_WIKI_CONTENT,
  MAX_WIKI_TITLE,
  WIKI_PAGE_TYPE_NOT_ALLOWED,
  wikiPageTypeRuleMessage,
} from './wiki-rule'
import {
  applyWikiTemplatePlaceholders,
  MAX_WIKI_TEMPLATES_PER_SPACE,
  WIKI_TEMPLATE_TOO_LONG,
  type WikiTemplateContext,
} from './wiki-template-rule'

/** ページ作成の選択肢(本文なし) */
export type WikiTemplateOption = { id: string; name: string; title: string; type: WikiPageType }

/** 管理画面の一覧 */
export type WikiTemplateItem = WikiTemplateOption & { content: string; order: number }

/** 置き換えた後のテンプレート */
export type RenderedWikiTemplate = { name: string; title: string; content: string; type: WikiPageType }

const OPTION_SELECT = { id: true, name: true, title: true, type: true } as const
const ITEM_SELECT = { ...OPTION_SELECT, content: true, order: true } as const

/** 同値の order でも並びが揺れないよう name を第 2 キーにする */
const ORDER_BY = [{ order: 'asc' }, { name: 'asc' }] as const

/** 管理の権限。manage に加えて、アーカイブされていないこと */
const assertManageable = async (actor: Actor, spaceId: string, tx: Db = prisma): Promise<WikiSpaceAccess> => {
  const access = await assertWikiSpaceAccess(actor, spaceId, 'manage', tx)
  if (access.archived) {
    throw errInvalidOperation()
  }
  return access
}

const assertTypeAllowed = (access: WikiSpaceAccess, type: WikiPageType) => {
  if (!isWikiPageTypeAllowed(access.type, type)) {
    throw new ClientError(WIKI_PAGE_TYPE_NOT_ALLOWED, wikiPageTypeRuleMessage(access.type, 'templates'))
  }
}

const findTemplateSpace = async (id: string, tx: Db) => {
  const template = await tx.wikiTemplate.findUnique({ where: { id }, select: { spaceId: true } })
  if (!template) {
    throw errInvalidOperation()
  }
  return template.spaceId
}

/**
 * テンプレートのスペース行をロックし、スペース ID を返す。
 * ロックを待つ間に同じスペースで消されていれば errInvalidOperation()(更新・並べ替えで Prisma の行なしエラーにしない)
 */
const lockTemplateSpace = async (tx: Db, id: string) => {
  const spaceId = await findTemplateSpace(id, tx)
  await lockWikiSpace(tx, spaceId)
  await findTemplateSpace(id, tx)
  return spaceId
}

/** 管理画面の一覧(本文込み、表示順)。アーカイブ済みでも読める(画面側で編集を閉じる) */
export const listWikiTemplatesForManage = async (actor: Actor, spaceId: string): Promise<WikiTemplateItem[]> => {
  await assertWikiSpaceAccess(actor, spaceId, 'manage')
  return prisma.wikiTemplate.findMany({ where: { spaceId }, select: ITEM_SELECT, orderBy: [...ORDER_BY] })
}

/** 認可済みの呼び出し元向けの選択肢(表示順) */
export const listWikiTemplateNames = async (spaceId: string, tx: Db = prisma): Promise<WikiTemplateOption[]> =>
  tx.wikiTemplate.findMany({ where: { spaceId }, select: OPTION_SELECT, orderBy: [...ORDER_BY] })

/** ページ作成の選択肢。ページを書ける人だけが引ける */
export const listWikiTemplateOptions = async (actor: Actor, spaceId: string): Promise<WikiTemplateOption[]> => {
  await assertWikiSpaceAccess(actor, spaceId, 'write')
  return listWikiTemplateNames(spaceId)
}

/** 追加。スペース行をロックしてから件数を数え、同時の追加で上限を超えないようにする。末尾に置く */
export const createWikiTemplate = async (
  actor: Actor,
  { spaceId, ...fields }: CreateWikiTemplate,
): Promise<WikiTemplateOption> => {
  const template = await prisma
    .$transaction(async (tx) => {
      await lockWikiSpace(tx, spaceId)
      const access = await assertManageable(actor, spaceId, tx)
      assertTypeAllowed(access, fields.type)
      const rows = await tx.wikiTemplate.findMany({ where: { spaceId }, select: { order: true } })
      if (rows.length >= MAX_WIKI_TEMPLATES_PER_SPACE) {
        throw errInvalidOperation()
      }
      const order = rows.reduce((max, row) => Math.max(max, row.order + 1), 0)
      return tx.wikiTemplate.create({
        data: { spaceId, ...fields, order, createdById: actor.id, updatedById: actor.id },
        select: OPTION_SELECT,
      })
    })
    .catch(rethrowUniqueViolation(errDuplicatedTemplateName))

  logger.info({ userId: actor.id, spaceId, id: template.id }, 'wiki template created')
  return template
}

export const updateWikiTemplate = async (
  actor: Actor,
  { id, ...fields }: UpdateWikiTemplate,
): Promise<WikiTemplateOption> => {
  const template = await prisma
    .$transaction(async (tx) => {
      const spaceId = await lockTemplateSpace(tx, id)
      const access = await assertManageable(actor, spaceId, tx)
      assertTypeAllowed(access, fields.type)
      return tx.wikiTemplate.update({
        where: { id },
        data: { ...fields, updatedById: actor.id },
        select: OPTION_SELECT,
      })
    })
    .catch(rethrowUniqueViolation(errDuplicatedTemplateName))

  logger.info({ userId: actor.id, id }, 'wiki template updated')
  return template
}

export const deleteWikiTemplate = async (actor: Actor, id: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await assertManageable(actor, await lockTemplateSpace(tx, id), tx)
    await tx.wikiTemplate.delete({ where: { id } })
  })

  logger.info({ userId: actor.id, id }, 'wiki template deleted')
}

/**
 * 表示順で隣と入れ替え、0 から振り直す。今の並びをロックの下で読むので、画面の並びが古くても隣の判定はずれない。
 * 端で動かせないときは何もしない
 */
export const moveWikiTemplate = async (actor: Actor, id: string, direction: 'up' | 'down'): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const spaceId = await lockTemplateSpace(tx, id)
    await assertManageable(actor, spaceId, tx)
    const ids = (
      await tx.wikiTemplate.findMany({ where: { spaceId }, select: { id: true }, orderBy: [...ORDER_BY] })
    ).map((row) => row.id)
    const from = ids.indexOf(id)
    const to = direction === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= ids.length) {
      return
    }
    const moving = ids[from]
    ids[from] = ids[to]
    ids[to] = moving
    for (const [order, rowId] of ids.entries()) {
      await tx.wikiTemplate.update({ where: { id: rowId }, data: { order }, select: { id: true } })
    }
  })

  logger.info({ userId: actor.id, id, direction }, 'wiki template moved')
}

/**
 * ページ作成に使うテンプレートを引き、作成者の表示名・タイムゾーンでプレースホルダーを置き換える。
 * 先に書き込みの権限を確かめ(他のスペースのテンプレートの有無を探らせない)、同じスペースのものだけを引く。
 * `id` で見つからなければ errInvalidOperation()、`name`(MCP)で見つからなければ既存の名前を添えて errValidation
 */
export const renderWikiTemplate = async (
  actor: Actor,
  spaceId: string,
  ref: { id: string } | { name: string },
  now: Date = new Date(),
): Promise<RenderedWikiTemplate> => {
  await assertWikiSpaceAccess(actor, spaceId, 'write')
  const template = await prisma.wikiTemplate.findFirst({
    where: { spaceId, ...('id' in ref ? { id: ref.id } : { name: ref.name.trim() }) },
    select: { name: true, title: true, content: true, type: true },
  })
  if (!template) {
    if ('id' in ref) {
      throw errInvalidOperation()
    }
    const names = (await listWikiTemplateNames(spaceId)).map(({ name }) => name)
    throw errValidation(
      `Unknown template in this space: ${ref.name}. Existing templates: ${names.length > 0 ? names.join(', ') : '(none)'}`,
    )
  }

  const { name: userName, timezone } = await getUserNameAndTimezone(actor.id)
  const context: WikiTemplateContext = { now, timezone, userName }
  return {
    name: template.name,
    title: applyWikiTemplatePlaceholders(template.title, context),
    content: applyWikiTemplatePlaceholders(template.content, context),
    type: template.type,
  }
}

/**
 * テンプレートから採るタイトル・本文が最大長に収まるかを確かめる。NG なら WIKI_TEMPLATE_TOO_LONG。
 * 登録時は置き換える前の長さで検査しているので、表示名などで伸びた分をここで弾き、テンプレートが原因だと分かるようにする。
 * 明示された値で置き換えて使わない項目は渡さない(使わない値の長さで作成を拒まない)
 */
export const assertWikiTemplateFits = (name: string, adopted: { title?: string; content?: string }): void => {
  if (
    (adopted.title !== undefined && adopted.title.length > MAX_WIKI_TITLE) ||
    (adopted.content !== undefined && adopted.content.length > MAX_WIKI_CONTENT)
  ) {
    throw new ClientError(
      WIKI_TEMPLATE_TOO_LONG,
      `The template ${name} exceeds the maximum length after replacing placeholders ` +
        `(title ${MAX_WIKI_TITLE} / content ${MAX_WIKI_CONTENT} characters). Shorten the template, or pass the title / content yourself`,
    )
  }
}

/** ページ作成の入力(画面・MCP 共通)。省いた項目はテンプレートで埋める */
export type WikiPageDraftInput = { title?: string; content?: string; type?: WikiPageType }

/**
 * ページ作成の入力にテンプレートを当てる。明示した値を優先し、省いた項目だけをテンプレートで埋める(明示した値は置き換えない)。
 * 種類は 明示 > 本文の front matter(`type: design_doc`)> テンプレート の順で決め、どれも無ければ undefined
 * (`createWikiPage` がロックを取った後に区分の既定にする)。テンプレートから採った項目だけを長さで確かめる
 */
export const applyWikiTemplateToPage = (
  input: WikiPageDraftInput,
  template: RenderedWikiTemplate | null,
): { title: string; content: string | undefined; type: WikiPageType | undefined } => {
  if (template) {
    assertWikiTemplateFits(template.name, {
      title: input.title === undefined ? template.title : undefined,
      content: input.content === undefined ? template.content : undefined,
    })
  }
  return {
    title: input.title ?? template?.title ?? '',
    content: input.content ?? template?.content,
    type:
      input.type ??
      (input.content && hasDesignDocFrontMatter(input.content) ? 'design_doc' : undefined) ??
      template?.type,
  }
}
