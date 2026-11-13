/** Wiki の MCP ツール(ref の解決・作成と更新の分岐・部分更新・移動・削除・節の取得・木) */

import { ClientError, errInvalidOperation, VALIDATION_ERROR } from '@/lib/error'
import { TOOL_ANNOTATIONS } from '@/lib/mcp/mcp'
import { resolveTicketId } from '@/lib/mcp/mcp-ticket'
import {
  deleteWikiPageForMcp,
  getWikiPageForMcp,
  getWikiTreeForMcp,
  registerWikiTools,
  saveWikiPageForMcp,
  searchWikiForMcp,
} from '@/lib/mcp/mcp-wiki'
import {
  createWikiPage,
  deleteWikiPage,
  findWikiPageByNumber,
  getWikiPage,
  getWikiTree,
  moveWikiPage,
  readWikiPageContent,
  updateWikiPage,
} from '@/lib/wiki/wiki-page'
import { WIKI_PAGE_CONFLICT, WIKI_PAGE_TOO_DEEP } from '@/lib/wiki/wiki-rule'
import { searchWikiPages } from '@/lib/wiki/wiki-search'
import { getWikiSpaceByKey } from '@/lib/wiki/wiki-space'
import { listWikiTags, resolveWikiTagIdsByName } from '@/lib/wiki/wiki-tag'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectMcpServer } from '../../helpers/mcp-client'
import { agentAuth, oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({}))
vi.mock('@/lib/mcp/mcp-ticket', () => ({ resolveTicketId: vi.fn() }))
vi.mock('@/lib/wiki/wiki-page', async (importOriginal) => ({
  errWikiPageConflict: (await importOriginal<typeof import('@/lib/wiki/wiki-page')>()).errWikiPageConflict,
  createWikiPage: vi.fn(),
  deleteWikiPage: vi.fn(),
  findWikiPageByNumber: vi.fn(),
  getWikiPage: vi.fn(),
  getWikiTree: vi.fn(),
  moveWikiPage: vi.fn(),
  readWikiPageContent: vi.fn(),
  updateWikiPage: vi.fn(),
}))
vi.mock('@/lib/wiki/wiki-space', () => ({
  getWikiSpaceByKey: vi.fn(),
  listWikiSpaces: vi.fn(),
}))
vi.mock('@/lib/wiki/wiki-tag', () => ({ listWikiTags: vi.fn(), resolveWikiTagIdsByName: vi.fn() }))
vi.mock('@/lib/wiki/wiki-search', () => ({ searchWikiPages: vi.fn() }))

const SPACE_ID = 'space-1'
const PAGE_ID = 'page-12'
const READ_AT = new Date('2026-11-01T00:00:00.000Z')
const SAVED_AT = new Date('2026-11-02T00:00:00.000Z')
const MOVED_AT = new Date('2026-11-03T00:00:00.000Z')
const human = oauthAuth()

const writeResult = (result: 'created' | 'updated' | 'moved' | 'unchanged', updatedAt = SAVED_AT) => ({
  result,
  id: PAGE_ID,
  ref: 'DOCS/12',
  number: 12,
  updatedAt,
})

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return e as ClientError
  }
  throw new Error('not rejected')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getWikiSpaceByKey).mockResolvedValue({
    space: { id: SPACE_ID, key: 'DOCS', name: '開発ドキュメント' },
    access: { spaceId: SPACE_ID, key: 'DOCS', canWrite: true },
  } as never)
  vi.mocked(findWikiPageByNumber).mockImplementation(async (_spaceId, number) =>
    number === 12
      ? { id: PAGE_ID, parentId: 'page-1', updatedAt: READ_AT }
      : number === 3
        ? { id: 'page-3', parentId: null, updatedAt: READ_AT }
        : number === 1
          ? { id: 'page-1', parentId: null, updatedAt: READ_AT }
          : null,
  )
  vi.mocked(readWikiPageContent).mockResolvedValue({ content: '# 手順\n古い手順\n', updatedAt: READ_AT })
  vi.mocked(resolveWikiTagIdsByName).mockResolvedValue(['tag-1'])
  vi.mocked(resolveTicketId).mockResolvedValue('ticket-1')
  vi.mocked(createWikiPage).mockResolvedValue(writeResult('created'))
  vi.mocked(updateWikiPage).mockResolvedValue(writeResult('updated'))
  vi.mocked(moveWikiPage).mockResolvedValue(writeResult('moved', MOVED_AT))
  vi.mocked(deleteWikiPage).mockResolvedValue({ deleted: 1 })
})

describe('saveWikiPageForMcp: 作成', () => {
  it('ref が無ければ、スペースの書き込み権限を確かめてから親・タグ・位置を解決して作る', async () => {
    const result = await saveWikiPageForMcp(agentAuth(), {
      space: 'docs',
      title: '新しいページ',
      content: '本文',
      parent: 'DOCS/3',
      position: 2,
      tags: ['設計'],
      ticketId: 'ABC-42',
      message: '初版',
    })

    expect(getWikiSpaceByKey).toHaveBeenCalledWith(agentAuth().user, 'docs', 'write')
    expect(resolveWikiTagIdsByName).toHaveBeenCalledWith(SPACE_ID, ['設計'])
    expect(createWikiPage).toHaveBeenCalledWith(
      agentAuth().user,
      { via: 'mcp' },
      SPACE_ID,
      { title: '新しいページ', content: '本文', type: 'page', parentId: 'page-3', position: 1, tagIds: ['tag-1'] },
      { ticketId: 'ticket-1', message: '初版' },
    )
    expect(result).toEqual({
      result: 'created',
      ref: 'DOCS/12',
      url: 'http://localhost:3000/wiki/DOCS/12',
      updatedAt: SAVED_AT,
    })
  })

  it('type を省くと、本文の front matter が type: design_doc なら設計書として作る', async () => {
    const typeOf = async (input: { content?: string; type?: 'page' | 'design_doc' }) => {
      vi.mocked(createWikiPage).mockClear()
      await saveWikiPageForMcp(human, { space: 'DOCS', title: 't', ...input })
      return vi.mocked(createWikiPage).mock.calls[0][3].type
    }
    const designDoc = '---\ntype: design_doc\ntitle: ログイン\n---\n\n# 概要'

    expect(await typeOf({ content: designDoc })).toBe('design_doc')
    expect(await typeOf({ content: '# 概要' })).toBe('page')
    expect(await typeOf({})).toBe('page')
    expect(await typeOf({ content: designDoc, type: 'page' }), '指定した type を優先する').toBe('page')
    expect(await typeOf({ content: '# 概要', type: 'design_doc' })).toBe('design_doc')
  })

  it('space か title が無ければエラー', async () => {
    expect((await errorOf(saveWikiPageForMcp(human, { title: 't' }))).errorType).toBe(VALIDATION_ERROR)
    expect((await errorOf(saveWikiPageForMcp(human, { space: 'DOCS' }))).errorType).toBe(VALIDATION_ERROR)
    expect(createWikiPage).not.toHaveBeenCalled()
  })

  it('作成で edits / expectedUpdatedAt は受けない', async () => {
    const error = await errorOf(
      saveWikiPageForMcp(human, { space: 'DOCS', title: 't', edits: [{ oldText: 'a', newText: 'b' }] }),
    )
    expect(error.errorType).toBe(VALIDATION_ERROR)
  })

  it('別のスペースのページは親にできない', async () => {
    const error = await errorOf(saveWikiPageForMcp(human, { space: 'DOCS', title: 't', parent: 'OPS/3' }))
    expect(error.message).toContain('same space')
  })

  it('書き込めないスペースでは、親やタグを引く前に弾く', async () => {
    vi.mocked(getWikiSpaceByKey).mockRejectedValue(errInvalidOperation())

    await errorOf(saveWikiPageForMcp(human, { space: 'DOCS', title: 't', parent: 'DOCS/3', tags: ['x'] }))
    expect(findWikiPageByNumber).not.toHaveBeenCalled()
    expect(resolveWikiTagIdsByName).not.toHaveBeenCalled()
  })
})

describe('saveWikiPageForMcp: 更新', () => {
  it('渡した項目だけを更新し、expectedUpdatedAt をそのまま渡す', async () => {
    await saveWikiPageForMcp(human, {
      ref: 'DOCS/12',
      title: '改名',
      expectedUpdatedAt: READ_AT.toISOString(),
      message: '名前を揃える',
    })

    expect(updateWikiPage).toHaveBeenCalledWith(
      human.user,
      { via: 'mcp' },
      PAGE_ID,
      { title: '改名', content: undefined, tagIds: undefined },
      { expectedUpdatedAt: READ_AT.toISOString(), ticketId: null, message: '名前を揃える' },
    )
    expect(moveWikiPage).not.toHaveBeenCalled()
  })

  it('type は渡したときだけ変え、type だけでも保存する(本文の front matter からは推定しない)', async () => {
    await saveWikiPageForMcp(human, { ref: 'DOCS/12', type: 'design_doc' })
    expect(vi.mocked(updateWikiPage).mock.calls[0][3]).toEqual({
      title: undefined,
      content: undefined,
      type: 'design_doc',
      tagIds: undefined,
    })

    await saveWikiPageForMcp(human, { ref: 'DOCS/12', content: '---\ntype: design_doc\n---\n' })
    expect(vi.mocked(updateWikiPage).mock.calls[1][3].type).toBeUndefined()
  })

  it('edits は読んだ本文に当て、指定が無くても読んだ時点の updatedAt で楽観ロックをかける', async () => {
    await saveWikiPageForMcp(human, { ref: 'DOCS/12', edits: [{ oldText: '古い手順', newText: '新しい手順' }] })

    expect(updateWikiPage).toHaveBeenCalledWith(
      human.user,
      { via: 'mcp' },
      PAGE_ID,
      { title: undefined, content: '# 手順\n新しい手順\n', tagIds: undefined },
      { expectedUpdatedAt: READ_AT.toISOString(), ticketId: null },
    )
  })

  it('edits で、読んだ後に更新されていれば WIKI_PAGE_CONFLICT', async () => {
    const error = await errorOf(
      saveWikiPageForMcp(human, {
        ref: 'DOCS/12',
        edits: [{ oldText: '古い手順', newText: 'x' }],
        expectedUpdatedAt: '2026-10-01T00:00:00.000Z',
      }),
    )
    expect(error.errorType).toBe(WIKI_PAGE_CONFLICT)
    expect(updateWikiPage).not.toHaveBeenCalled()
  })

  it('content と edits の同時指定・space の指定・何も無い保存はエラー', async () => {
    const cases = [
      { ref: 'DOCS/12', content: 'x', edits: [{ oldText: 'a', newText: 'b' }] },
      { ref: 'DOCS/12', space: 'OPS', title: 't' },
      { ref: 'DOCS/12' },
    ]
    for (const input of cases) {
      expect((await errorOf(saveWikiPageForMcp(human, input))).errorType).toBe(VALIDATION_ERROR)
    }
    expect(updateWikiPage).not.toHaveBeenCalled()
  })

  it('無いページはエラーにし、ref の形式違いも入力エラーにする', async () => {
    expect((await errorOf(saveWikiPageForMcp(human, { ref: 'DOCS/99', title: 't' }))).message).toContain(
      'No page DOCS/99',
    )
    expect((await errorOf(saveWikiPageForMcp(human, { ref: 'DOCS-12', title: 't' }))).message).toContain('KEY/number')
  })

  it('position だけなら、親を渡さず(今の親のまま)0 始まりの位置へ移す', async () => {
    const result = await saveWikiPageForMcp(human, { ref: 'DOCS/12', position: 1 })

    expect(updateWikiPage).not.toHaveBeenCalled()
    expect(moveWikiPage).toHaveBeenCalledWith(
      human.user,
      { via: 'mcp' },
      PAGE_ID,
      { parentId: undefined, position: 0 },
      { expectedUpdatedAt: undefined, ticketId: null },
    )
    expect(result.result).toBe('moved')
  })

  it('今と同じ親を位置なしで渡しても動かさない(末尾へ送らない)', async () => {
    const result = await saveWikiPageForMcp(human, { ref: 'DOCS/12', title: '改名', parent: 'DOCS/1' })

    expect(moveWikiPage).not.toHaveBeenCalled()
    expect(result.result).toBe('updated')
    expect((await saveWikiPageForMcp(human, { ref: 'DOCS/12', parent: 'DOCS/1' })).result).toBe('unchanged')
    expect(updateWikiPage).toHaveBeenCalledTimes(1)
  })

  it('無い親は、内容を書く前にエラーにする', async () => {
    const error = await errorOf(saveWikiPageForMcp(human, { ref: 'DOCS/12', title: '改名', parent: 'DOCS/99' }))

    expect(error.message).toContain('No page DOCS/99')
    expect(updateWikiPage).not.toHaveBeenCalled()
  })

  it('parent: null はスペース直下への移動', async () => {
    await saveWikiPageForMcp(human, { ref: 'DOCS/12', parent: null })

    expect(vi.mocked(moveWikiPage).mock.calls[0][3]).toEqual({ parentId: null, position: undefined })
  })

  it('内容と移動を一度に渡すと、更新の後に、更新後の updatedAt で移動する', async () => {
    const result = await saveWikiPageForMcp(human, { ref: 'DOCS/12', title: '改名', parent: 'DOCS/3' })

    expect(vi.mocked(moveWikiPage).mock.calls[0][3]).toEqual({ parentId: 'page-3', position: undefined })
    expect(vi.mocked(moveWikiPage).mock.calls[0][4]).toEqual({
      expectedUpdatedAt: SAVED_AT.toISOString(),
      ticketId: null,
    })
    expect(result).toMatchObject({ result: 'updated+moved', updatedAt: MOVED_AT })
  })

  it('更新の後に移動が失敗したら、内容は保存済みであることをエラーで伝える', async () => {
    vi.mocked(moveWikiPage).mockRejectedValue(new ClientError(WIKI_PAGE_TOO_DEEP, 'too deep'))

    const error = await errorOf(saveWikiPageForMcp(human, { ref: 'DOCS/12', title: '改名', parent: 'DOCS/3' }))
    expect(error.errorType).toBe(WIKI_PAGE_TOO_DEEP)
    expect(error.message).toContain('were saved')
    expect(error.message).toContain('too deep')
  })
})

describe('deleteWikiPageForMcp', () => {
  it('recursive と ticketId を渡して削除する', async () => {
    expect(await deleteWikiPageForMcp(human, { ref: 'DOCS/12', recursive: true, ticketId: 'ABC-42' })).toEqual({
      deleted: 1,
    })
    expect(getWikiSpaceByKey).toHaveBeenCalledWith(human.user, 'DOCS', 'write')
    expect(deleteWikiPage).toHaveBeenCalledWith(human.user, { via: 'mcp' }, PAGE_ID, {
      recursive: true,
      ticketId: 'ticket-1',
    })
  })

  it('無いページは deleted: 0 を返す(繰り返しても結果が変わらない)', async () => {
    expect(await deleteWikiPageForMcp(human, { ref: 'DOCS/99' })).toEqual({ deleted: 0 })
    expect(deleteWikiPage).not.toHaveBeenCalled()
  })

  it('子を持つページを recursive なしで消そうとしたエラーはそのまま返す', async () => {
    vi.mocked(deleteWikiPage).mockRejectedValue(new ClientError('WIKI_PAGE_HAS_CHILDREN', 'has children'))

    expect((await errorOf(deleteWikiPageForMcp(human, { ref: 'DOCS/12' }))).errorType).toBe('WIKI_PAGE_HAS_CHILDREN')
    expect(vi.mocked(deleteWikiPage).mock.calls[0][3]).toEqual({ recursive: undefined, ticketId: null })
  })
})

const PAGE_CONTENT =
  '# 概要\n前書き\n## 手順\n手順の本文 ![図](/api/upload/019eef64-6cc1-78f1-8f50-1ef86986289a.webp)\n## 運用\n運用の本文'

const pageDetail = () =>
  ({
    space: { id: SPACE_ID, key: 'DOCS', name: '開発ドキュメント' },
    access: { canWrite: false },
    page: {
      id: PAGE_ID,
      number: 12,
      title: 'API',
      content: PAGE_CONTENT,
      type: 'page',
      updatedAt: READ_AT,
      updatedBy: { name: 'tester' },
      tags: [{ tag: { id: 't1', name: '設計' } }],
    },
    ancestors: [{ number: 1, title: '設計' }],
    children: [{ number: 13, title: '認証' }],
    tree: [],
  }) as never

describe('getWikiPageForMcp', () => {
  beforeEach(() => {
    vi.mocked(getWikiPage).mockResolvedValue(pageDetail())
  })

  it('パンくず・子ページを ref 付きで、種類・タグ名・updatedAt・canEdit と一緒に返す', async () => {
    const result = await getWikiPageForMcp(human, { ref: 'docs/12' })

    expect(getWikiPage).toHaveBeenCalledWith(human.user, 'DOCS', 12)
    expect(result).toMatchObject({
      ref: 'DOCS/12',
      url: 'http://localhost:3000/wiki/DOCS/12',
      title: 'API',
      type: 'page',
      breadcrumbs: [{ ref: 'DOCS/1', title: '設計' }],
      children: [{ ref: 'DOCS/13', title: '認証' }],
      tags: ['設計'],
      content: PAGE_CONTENT,
      attachmentKeys: ['019eef64-6cc1-78f1-8f50-1ef86986289a.webp'],
      updatedAt: READ_AT,
      canEdit: false,
    })
  })

  it('section を渡すとその節だけを返し、添付のキーも節の中から拾う', async () => {
    const result = await getWikiPageForMcp(human, { ref: 'DOCS/12', section: '運用' })

    expect(result).toMatchObject({ section: '運用', content: '## 運用\n運用の本文' })
    expect(result).not.toHaveProperty('attachmentKeys')
  })

  it('見出しが無ければ、見出しの一覧を添えたエラー', async () => {
    const error = await errorOf(getWikiPageForMcp(human, { ref: 'DOCS/12', section: '存在しない' }))

    expect(error.errorType).toBe(VALIDATION_ERROR)
    expect(error.message).toContain('# 概要 | ## 手順 | ## 運用')
  })
})

describe('getWikiTreeForMcp', () => {
  beforeEach(() => {
    vi.mocked(getWikiSpaceByKey).mockResolvedValue({
      space: { id: SPACE_ID, key: 'DOCS', name: '開発ドキュメント' },
    } as never)
    vi.mocked(listWikiTags).mockResolvedValue([{ id: 't1', name: '設計', color: 'red', order: 1 }])
    vi.mocked(getWikiTree).mockResolvedValue([
      { id: 'p1', parentId: null, number: 1, title: '設計', order: 0, tagIds: ['t1'] },
      { id: 'p2', parentId: 'p1', number: 2, title: 'API', order: 0, tagIds: [] },
      { id: 'p3', parentId: 'p2', number: 3, title: '認証', order: 0, tagIds: [] },
    ])
  })

  it('ref・タイトル・タグ名の入れ子で返し、depth を超えた子は childCount にする', async () => {
    expect(await getWikiTreeForMcp(human, { space: 'DOCS', depth: 2 })).toEqual({
      space: { key: 'DOCS', name: '開発ドキュメント' },
      pages: [
        {
          ref: 'DOCS/1',
          title: '設計',
          tags: ['設計'],
          children: [{ ref: 'DOCS/2', title: 'API', childCount: 1 }],
        },
      ],
      totalPages: 3,
    })
  })

  it('root を渡すとその配下だけを返す。別スペースの root はエラー', async () => {
    expect(await getWikiTreeForMcp(human, { space: 'DOCS', root: 'DOCS/2' })).toMatchObject({
      root: { ref: 'DOCS/2', title: 'API' },
      pages: [{ ref: 'DOCS/3', title: '認証' }],
    })
    expect((await errorOf(getWikiTreeForMcp(human, { space: 'DOCS', root: 'OPS/2' }))).errorType).toBe(VALIDATION_ERROR)
  })
})

describe('searchWikiForMcp', () => {
  it('語もタグも無ければエラー', async () => {
    expect((await errorOf(searchWikiForMcp(human, { keyword: '  ' }))).errorType).toBe(VALIDATION_ERROR)
    expect(searchWikiPages).not.toHaveBeenCalled()
  })

  it('ヒットをスペースのキーとタグ名で返し、上限まで返したら limitReached を付ける', async () => {
    vi.mocked(searchWikiPages).mockResolvedValue([
      {
        id: 'p1',
        ref: 'DOCS/1',
        space: { id: SPACE_ID, key: 'DOCS', name: '開発' },
        number: 1,
        title: '設計',
        updatedAt: READ_AT,
        tags: [{ id: 't1', name: '設計', color: 'red' }],
        breadcrumbs: [],
        snippet: '…設計の…',
      },
    ])

    const result = await searchWikiForMcp(human, { keyword: '設計', space: 'DOCS', limit: 1 })

    expect(searchWikiPages).toHaveBeenCalledWith(human.user, {
      keyword: '設計',
      space: 'DOCS',
      tags: undefined,
      limit: 1,
    })
    expect(result).toEqual({
      pages: [{ ref: 'DOCS/1', title: '設計', space: 'DOCS', tags: ['設計'], snippet: '…設計の…', updatedAt: READ_AT }],
      limitReached: true,
    })
  })
})

describe('registerWikiTools', () => {
  const connect = () => {
    const server = new McpServer({ name: 'devuntu', version: '1.0.0' })
    registerWikiTools(server, human)
    return connectMcpServer(server)
  }

  it('6ツールを読み取り / 書き込みの注釈付きで登録する', async () => {
    const { tools } = await (await connect()).listTools()
    const annotations = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]))

    expect(annotations).toEqual({
      list_wiki_spaces: TOOL_ANNOTATIONS.readOnly,
      get_wiki_tree: TOOL_ANNOTATIONS.readOnly,
      search_wiki: TOOL_ANNOTATIONS.readOnly,
      get_wiki_page: TOOL_ANNOTATIONS.readOnly,
      save_wiki_page: TOOL_ANNOTATIONS.destructive,
      delete_wiki_page: TOOL_ANNOTATIONS.destructiveIdempotent,
    })
  })

  it('入力スキーマ: ページは ref で受け、save は作成と更新・移動の項目を、delete は recursive を持つ', async () => {
    const { tools } = await (await connect()).listTools()
    const props = (name: string) => Object.keys(tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {})
    const required = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema.required ?? []

    expect(props('save_wiki_page').toSorted()).toEqual(
      [
        'content',
        'edits',
        'expectedUpdatedAt',
        'message',
        'parent',
        'position',
        'ref',
        'space',
        'tags',
        'ticketId',
        'title',
        'type',
      ].toSorted(),
    )
    expect(required('save_wiki_page')).toEqual([])
    expect(props('delete_wiki_page').toSorted()).toEqual(['recursive', 'ref', 'ticketId'])
    expect(required('delete_wiki_page')).toEqual(['ref'])
    expect(props('get_wiki_page').toSorted()).toEqual(['ref', 'section'])
    expect(props('get_wiki_tree').toSorted()).toEqual(['depth', 'root', 'space'])
    expect(props('search_wiki').toSorted()).toEqual(['keyword', 'limit', 'space', 'tags'])
    expect(props('list_wiki_spaces')).toEqual(['includeArchived'])
  })

  it('未知の項目・範囲外の position は入力エラーにする', async () => {
    const client = await connect()

    const unknown = await client.callTool({ name: 'save_wiki_page', arguments: { ref: 'DOCS/12', recursive: true } })
    const position = await client.callTool({ name: 'save_wiki_page', arguments: { ref: 'DOCS/12', position: 0 } })

    expect(unknown.isError).toBe(true)
    expect(position.isError).toBe(true)
    expect(updateWikiPage).not.toHaveBeenCalled()
    expect(moveWikiPage).not.toHaveBeenCalled()
  })
})
