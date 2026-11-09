/**
 * Wiki の MCP ツール(サーバー専用)
 *
 * ツールの定義はセッションごとに読まれるので6本に絞る(作成と更新・移動は save_wiki_page にまとめる)。
 * ページは `KEY/番号`(ref)で指定する。改名や移動で変わらないので、チケットの本文などに書いておける。
 * 本文はトークンを食うので、読むときは section で節だけ、書くときは edits で差分だけを渡せるようにする。
 *
 * 権限は画面と同じ関数(assertWikiSpaceAccess と wiki-page.ts の書き込み)に委ねる。
 * スペースの作成・設定・割り当て、版の復元は画面で行う。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { MAX_TAG_NAME } from '../board/tag-rule'
import { ClientError, errInvalidOperation, errValidation } from '../error'
import type { ResourceAuth } from '../oauth/oauth-resource'
import { makeUrl } from '../server-utils'
import { extractUploadKeys } from '../storage/upload'
import { assertWikiSpaceAccess, type WikiSpaceAccess } from '../wiki/wiki-access'
import { applyTextEdits, extractMarkdownSection, listMarkdownHeadings, type TextEdit } from '../wiki/wiki-markdown'
import {
  createWikiPage,
  deleteWikiPage,
  errWikiPageConflict,
  findWikiPageByNumber,
  getWikiPage,
  getWikiTree,
  moveWikiPage,
  readWikiPageContent,
  updateWikiPage,
  type WikiPageWriteResult,
} from '../wiki/wiki-page'
import {
  DEFAULT_WIKI_SEARCH_LIMIT,
  MAX_WIKI_CONTENT,
  MAX_WIKI_DEPTH,
  MAX_WIKI_PAGE_TAGS,
  MAX_WIKI_SEARCH_KEYWORD,
  MAX_WIKI_SEARCH_LIMIT,
  MAX_WIKI_SPACE_KEY,
  MAX_WIKI_TITLE,
  parseWikiPageRef,
  wikiPagePath,
  wikiPageRef,
  type WikiWriter,
} from '../wiki/wiki-rule'
import { searchWikiPages } from '../wiki/wiki-search'
import { findWikiSpaceIdByKey, getWikiSpaceByKey, listWikiSpaces } from '../wiki/wiki-space'
import { listWikiTags, resolveWikiTagIdsByName } from '../wiki/wiki-tag'
import { nestWikiTree } from '../wiki/wiki-tree'
import { jsonResult, TOOL_ANNOTATIONS } from './mcp'
import { resolveTicketId } from './mcp-ticket'

const WRITER: WikiWriter = { via: 'mcp' }

/** 部分更新の件数の上限 */
const MAX_WIKI_EDITS = 50
/** 見出しが見つからないときにエラーへ並べる見出しの数 */
const MAX_LISTED_HEADINGS = 50

const pageUrl = (ref: { key: string; number: number }) => makeUrl(wikiPagePath(ref)).toString()

const parseRef = (ref: string, field = 'ref') => {
  const parsed = parseWikiPageRef(ref)
  if (!parsed) {
    throw errValidation(`${field} must be KEY/number (e.g. DOCS/12), got ${ref}`)
  }
  return parsed
}

const errNoPage = (ref: string) => errValidation(`No page ${ref} exists. Find pages with search_wiki or get_wiki_tree`)

/** スペースキーから id を引き、権限を確かめる。無い・権限が無いは区別しない */
const resolveSpace = async (auth: ResourceAuth, key: string, need: 'view' | 'write') => {
  const spaceId = await findWikiSpaceIdByKey(key)
  if (!spaceId) {
    throw errInvalidOperation()
  }
  return assertWikiSpaceAccess(auth.user, spaceId, need)
}

/**
 * ref のページを引く。スペースの権限を先に確かめてからページの有無を見る(他のスペースのページの有無を探らせない)。
 * ページが無ければ page は null
 */
export const resolveWikiPageRef = async (auth: ResourceAuth, ref: string, need: 'view' | 'write') => {
  const parsed = parseRef(ref)
  const access = await resolveSpace(auth, parsed.key, need)
  const page = await findWikiPageByNumber(access.spaceId, parsed.number)
  return { access, ref: wikiPageRef({ key: access.key, number: parsed.number }), page }
}

/** 親に指定された ref を、同じスペースのページの id にする */
const resolveParentId = async (access: WikiSpaceAccess, parent: string): Promise<string> => {
  const parsed = parseRef(parent, 'parent')
  if (parsed.key !== access.key) {
    throw errValidation(`parent must be a page in the same space (${access.key})`)
  }
  const page = await findWikiPageByNumber(access.spaceId, parsed.number)
  if (!page) {
    throw errNoPage(parent)
  }
  return page.id
}

/** MCP の position は 1 始まり(チケットの childOrder にそろえる) */
const toPosition = (position: number | undefined) => (position === undefined ? undefined : position - 1)

export const listWikiSpacesForMcp = async (auth: ResourceAuth, input: { includeArchived?: boolean }) => {
  const spaces = await listWikiSpaces(auth.user, { includeArchived: input.includeArchived })
  return spaces.map((space) => ({
    key: space.key,
    name: space.name,
    ...(space.description ? { description: space.description } : {}),
    visibility: space.visibility,
    role: space.role,
    canWrite: space.canWrite,
    ...(space.archived ? { archived: true } : {}),
  }))
}

export const getWikiTreeForMcp = async (
  auth: ResourceAuth,
  input: { space: string; root?: string; depth?: number },
) => {
  const { space } = await getWikiSpaceByKey(auth.user, input.space)
  const [rows, tags] = await Promise.all([getWikiTree(auth.user, space.id), listWikiTags(space.id)])
  const tagName = new Map(tags.map(({ id, name }) => [id, name]))

  let root: (typeof rows)[number] | undefined
  if (input.root) {
    const parsed = parseRef(input.root, 'root')
    if (parsed.key !== space.key) {
      throw errValidation(`root must be a page in the space ${space.key}`)
    }
    root = rows.find(({ number }) => number === parsed.number)
    if (!root) {
      throw errNoPage(input.root)
    }
  }

  const pages = nestWikiTree(
    rows,
    ({ number, title, tagIds }) => {
      const names = tagIds.map((id) => tagName.get(id)).filter((name) => name !== undefined)
      return { ref: wikiPageRef({ key: space.key, number }), title, ...(names.length > 0 ? { tags: names } : {}) }
    },
    { rootId: root?.id ?? null, depth: input.depth },
  )
  return {
    space: { key: space.key, name: space.name },
    ...(root ? { root: { ref: wikiPageRef({ key: space.key, number: root.number }), title: root.title } } : {}),
    pages,
    totalPages: rows.length,
  }
}

export const searchWikiForMcp = async (
  auth: ResourceAuth,
  input: { keyword?: string; space?: string; tags?: string[]; limit?: number },
) => {
  const keyword = input.keyword?.trim() ?? ''
  if (keyword === '' && (input.tags ?? []).length === 0) {
    throw errValidation('Specify keyword or tags')
  }
  const hits = await searchWikiPages(auth.user, {
    keyword,
    space: input.space,
    tags: input.tags,
    limit: input.limit,
  })
  const limit = input.limit ?? DEFAULT_WIKI_SEARCH_LIMIT
  return {
    pages: hits.map((hit) => ({
      ref: hit.ref,
      title: hit.title,
      space: hit.space.key,
      ...(hit.breadcrumbs.length > 0 ? { breadcrumbs: hit.breadcrumbs } : {}),
      ...(hit.tags.length > 0 ? { tags: hit.tags.map(({ name }) => name) } : {}),
      snippet: hit.snippet,
      updatedAt: hit.updatedAt,
    })),
    /** 上限まで返したときは、ほかにも一致するページがありうる */
    ...(hits.length >= limit ? { limitReached: true } : {}),
  }
}

export const getWikiPageForMcp = async (auth: ResourceAuth, input: { ref: string; section?: string }) => {
  const parsed = parseRef(input.ref)
  const { space, access, page, ancestors, children } = await getWikiPage(auth.user, parsed.key, parsed.number)
  const refOf = (number: number) => wikiPageRef({ key: space.key, number })

  let body: { content: string } | { section: string; content: string } = { content: page.content }
  if (input.section !== undefined) {
    const section = extractMarkdownSection(page.content, input.section)
    if (section === null) {
      const headings = listMarkdownHeadings(page.content)
        .slice(0, MAX_LISTED_HEADINGS)
        .map(({ level, text }) => `${'#'.repeat(level)} ${text}`)
      throw errValidation(
        `No heading "${input.section}" in ${refOf(page.number)}. ` +
          (headings.length > 0 ? `Headings: ${headings.join(' | ')}` : 'The page has no headings'),
      )
    }
    body = { section: input.section, content: section }
  }
  const attachmentKeys = extractUploadKeys(body.content)

  return {
    ref: refOf(page.number),
    url: pageUrl({ key: space.key, number: page.number }),
    space: { key: space.key, name: space.name },
    title: page.title,
    ...(ancestors.length > 0
      ? { breadcrumbs: ancestors.map(({ number, title }) => ({ ref: refOf(number), title })) }
      : {}),
    ...(page.tags.length > 0 ? { tags: page.tags.map(({ tag }) => tag.name) } : {}),
    ...body,
    ...(attachmentKeys.length > 0 ? { attachmentKeys } : {}),
    ...(children.length > 0 ? { children: children.map(({ number, title }) => ({ ref: refOf(number), title })) } : {}),
    /** 更新するときに expectedUpdatedAt へ渡せば、他の人の更新を上書きせずに済む */
    updatedAt: page.updatedAt,
    updatedByName: page.updatedBy?.name ?? '',
    canEdit: access.canWrite,
  }
}

export type McpSaveWikiPageInput = {
  ref?: string
  space?: string
  title?: string
  content?: string
  edits?: TextEdit[]
  parent?: string | null
  position?: number
  tags?: string[]
  expectedUpdatedAt?: string
  ticketId?: string
}

const writeResult = (result: string, written: WikiPageWriteResult, key: string) => ({
  result,
  ref: written.ref,
  url: pageUrl({ key, number: written.number }),
  updatedAt: written.updatedAt,
})

const createWikiPageForMcp = async (auth: ResourceAuth, input: McpSaveWikiPageInput, ticketId: string | null) => {
  if (!input.space || input.title === undefined) {
    throw errValidation('space and title are required to create a page. Pass ref to update an existing page')
  }
  if (input.edits || input.expectedUpdatedAt) {
    throw errValidation('edits and expectedUpdatedAt are only for updating an existing page (pass ref)')
  }
  // 親やタグの有無で他のスペースの中身を探れないよう、先に権限を確かめる
  const access = await resolveSpace(auth, input.space, 'write')
  const parentId = input.parent ? await resolveParentId(access, input.parent) : null
  const tagIds = input.tags ? await resolveWikiTagIdsByName(access.spaceId, input.tags) : []
  const created = await createWikiPage(
    auth.user,
    WRITER,
    access.spaceId,
    { title: input.title, content: input.content, parentId, position: toPosition(input.position), tagIds },
    { ticketId },
  )
  return writeResult(created.result, created, access.key)
}

const updateWikiPageForMcp = async (
  auth: ResourceAuth,
  ref: string,
  input: McpSaveWikiPageInput,
  ticketId: string | null,
) => {
  if (input.space) {
    throw errValidation('space is only for creating a page. Pages cannot be moved to another space')
  }
  if (input.content !== undefined && input.edits) {
    throw errValidation('Pass either content or edits, not both')
  }
  const { access, page, ref: pageRef } = await resolveWikiPageRef(auth, ref, 'write')
  if (!page) {
    throw errNoPage(pageRef)
  }

  let content = input.content
  let expectedUpdatedAt = input.expectedUpdatedAt
  if (input.edits) {
    const current = await readWikiPageContent(page.id)
    if (!current) {
      throw errNoPage(pageRef)
    }
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) {
      throw errWikiPageConflict()
    }
    content = applyTextEdits(current.content, input.edits)
    // edits は読んだ本文に当てたものなので、指定が無くても読んだ時点の版で楽観ロックをかける
    expectedUpdatedAt = current.updatedAt.toISOString()
  }
  const tagIds = input.tags ? await resolveWikiTagIdsByName(access.spaceId, input.tags) : undefined
  const wantsUpdate = input.title !== undefined || content !== undefined || tagIds !== undefined
  const wantsMove = input.parent !== undefined || input.position !== undefined
  if (!wantsUpdate && !wantsMove) {
    throw errValidation('Nothing to save. Pass title, content, edits, tags, parent or position')
  }

  const updated = wantsUpdate
    ? await updateWikiPage(
        auth.user,
        WRITER,
        page.id,
        { title: input.title, content, tagIds },
        { expectedUpdatedAt, ticketId },
      )
    : undefined
  if (!wantsMove) {
    return writeResult(updated!.result, updated!, access.key)
  }

  try {
    const parentId =
      input.parent === undefined
        ? page.parentId
        : input.parent === null
          ? null
          : await resolveParentId(access, input.parent)
    const moved = await moveWikiPage(
      auth.user,
      WRITER,
      page.id,
      { parentId, position: toPosition(input.position) },
      { expectedUpdatedAt: updated ? updated.updatedAt.toISOString() : expectedUpdatedAt, ticketId },
    )
    const changed = [updated?.result, moved.result].filter((result) => result && result !== 'unchanged')
    return writeResult(changed.length > 0 ? changed.join('+') : 'unchanged', moved, access.key)
  } catch (error) {
    // 内容は保存済みなので、移動だけをやり直せばよいと分かるようにする
    if (updated?.result === 'updated' && error instanceof ClientError) {
      throw new ClientError(
        error.errorType,
        `The title / content / tags were saved (updatedAt: ${updated.updatedAt.toISOString()}), but moving the page failed: ${error.message}`,
      )
    }
    throw error
  }
}

/** ref が無ければ作成し、あれば渡した項目だけを更新・移動する */
export const saveWikiPageForMcp = async (auth: ResourceAuth, input: McpSaveWikiPageInput) => {
  const ticketId = input.ticketId ? await resolveTicketId(auth, input.ticketId) : null
  return input.ref
    ? updateWikiPageForMcp(auth, input.ref, input, ticketId)
    : createWikiPageForMcp(auth, input, ticketId)
}

/** 同じ入力で繰り返しても結果が変わらないよう、無いページは deleted: 0 で返す */
export const deleteWikiPageForMcp = async (
  auth: ResourceAuth,
  input: { ref: string; recursive?: boolean; ticketId?: string },
) => {
  const { page } = await resolveWikiPageRef(auth, input.ref, 'write')
  if (!page) {
    return { deleted: 0 }
  }
  const ticketId = input.ticketId ? await resolveTicketId(auth, input.ticketId) : null
  return deleteWikiPage(auth.user, WRITER, page.id, { recursive: input.recursive, ticketId })
}

export const zWikiPageRef = z.string().trim().min(1).max(30)

const zSpaceKey = z.string().trim().min(1).max(MAX_WIKI_SPACE_KEY)

const zWikiTicketId = z
  .string()
  .min(1)
  .optional()
  .describe('Ticket you are working on (display ID allowed). Recorded in the page history')

export const registerWikiTools = (server: McpServer, auth: ResourceAuth) => {
  server.registerTool(
    'list_wiki_spaces',
    {
      title: 'List wiki spaces',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        'Returns the Wiki spaces you can read, with your role and whether you can write. ' +
        'Spaces assigned to a board are also listed as wikiSpaces in get_ticket / get_board',
      inputSchema: z.strictObject({
        includeArchived: z.boolean().optional().describe('Include archived (read-only) spaces. Excluded by default'),
      }),
    },
    async (input) => jsonResult(await listWikiSpacesForMcp(auth, input)),
  )

  server.registerTool(
    'get_wiki_tree',
    {
      title: 'Get wiki tree',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        'Returns the page hierarchy of a Wiki space (ref, title and tags only, no content). ' +
        'Pass root to get only the pages under it, and depth to limit the levels (deeper pages are summarized as childCount)',
      inputSchema: z.strictObject({
        space: zSpaceKey.describe('Space key (e.g. DOCS)'),
        root: zWikiPageRef.optional().describe('ref of the page whose descendants to return'),
        depth: z.number().int().min(1).max(MAX_WIKI_DEPTH).optional().describe('Levels to return. All by default'),
      }),
    },
    async (input) => jsonResult(await getWikiTreeForMcp(auth, input)),
  )

  server.registerTool(
    'search_wiki',
    {
      title: 'Search wiki',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        'Searches Wiki pages you can read. Every word of keyword must match the title, content or a tag name. ' +
        'Results are ordered by title matches, then by most recently updated, with a snippet around the first match. ' +
        'Read a hit with get_wiki_page',
      inputSchema: z.strictObject({
        keyword: z
          .string()
          .max(MAX_WIKI_SEARCH_KEYWORD)
          .optional()
          .describe('Space-separated words (all must match). Words of 3+ characters search faster'),
        space: zSpaceKey.optional().describe('Space key to search in. All readable spaces by default'),
        tags: z
          .array(z.string().min(1).max(MAX_TAG_NAME))
          .max(MAX_WIKI_PAGE_TAGS)
          .optional()
          .describe('Tag names: only pages with any of them'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_WIKI_SEARCH_LIMIT)
          .optional()
          .describe(
            `Defaults to ${DEFAULT_WIKI_SEARCH_LIMIT}. limitReached in the response means more pages may match`,
          ),
      }),
    },
    async (input) => jsonResult(await searchWikiForMcp(auth, input)),
  )

  server.registerTool(
    'get_wiki_page',
    {
      title: 'Get wiki page',
      annotations: TOOL_ANNOTATIONS.readOnly,
      description:
        'Reads a Wiki page (Markdown) by ref, with breadcrumbs, child pages, tags and updatedAt. ' +
        'Pass section with a heading to read only that section (including its subsections) and save tokens; ' +
        'an unknown heading returns the list of headings. Images and files in the content can be read with get_image / get_file',
      inputSchema: z.strictObject({
        ref: zWikiPageRef.describe('Page ref KEY/number (e.g. DOCS/12)'),
        section: z.string().min(1).max(MAX_WIKI_TITLE).optional().describe('Heading text, without the leading #'),
      }),
    },
    async (input) => jsonResult(await getWikiPageForMcp(auth, input)),
  )

  server.registerTool(
    'save_wiki_page',
    {
      title: 'Save wiki page',
      annotations: TOOL_ANNOTATIONS.destructive,
      description:
        'Creates a Wiki page when ref is omitted (space and title required), or updates the page with ref: only the fields you pass change. ' +
        'Before updating, read the page with get_wiki_page and pass its updatedAt as expectedUpdatedAt so you do not overwrite changes by others. ' +
        'For partial changes use edits instead of sending the whole content: each oldText must match exactly one place, and edits are checked against the content as you read it. ' +
        'parent / position move the page within the space. tags replace all tags of the page and must be existing tag names of the space. ' +
        'Write only what the user asked for or agreed to; every change is kept in the page history, from which users can restore it',
      inputSchema: z.strictObject({
        ref: zWikiPageRef.optional().describe('Page ref KEY/number to update. Omit to create a page'),
        space: zSpaceKey.optional().describe('Space key to create the page in. Only when creating'),
        title: z.string().min(1).max(MAX_WIKI_TITLE).optional().describe('Required when creating'),
        content: z.string().max(MAX_WIKI_CONTENT).optional().describe('Markdown body. Replaces the whole content'),
        edits: z
          .array(
            z.strictObject({
              oldText: z.string().min(1).max(MAX_WIKI_CONTENT).describe('Exact text to replace'),
              newText: z.string().max(MAX_WIKI_CONTENT).describe('Replacement (empty to delete)'),
            }),
          )
          .min(1)
          .max(MAX_WIKI_EDITS)
          .optional()
          .describe('Partial changes applied in order. Mutually exclusive with content'),
        parent: zWikiPageRef
          .nullable()
          .optional()
          .describe('ref of the parent page in the same space. null for the top level'),
        position: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .optional()
          .describe('Position among the siblings (1-based). Defaults to the end when the parent changes'),
        tags: z.array(z.string().min(1).max(MAX_TAG_NAME)).max(MAX_WIKI_PAGE_TAGS).optional().describe('Tag names'),
        expectedUpdatedAt: z.iso
          .datetime()
          .optional()
          .describe('updatedAt from get_wiki_page. The save fails if someone updated the page after you read it'),
        ticketId: zWikiTicketId,
      }),
    },
    async (input) => jsonResult(await saveWikiPageForMcp(auth, input)),
  )

  server.registerTool(
    'delete_wiki_page',
    {
      title: 'Delete wiki page',
      annotations: TOOL_ANNOTATIONS.destructiveIdempotent,
      description:
        'Deletes a Wiki page. A page with child pages is deleted only with recursive=true, together with all its descendants; ' +
        'confirm with the user before deleting descendants. Users can restore deleted pages from the history for a limited period',
      inputSchema: z.strictObject({
        ref: zWikiPageRef.describe('Page ref KEY/number'),
        recursive: z.boolean().optional().describe('Also delete all descendant pages'),
        ticketId: zWikiTicketId,
      }),
    },
    async (input) => jsonResult(await deleteWikiPageForMcp(auth, input)),
  )
}
