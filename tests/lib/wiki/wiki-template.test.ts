/**
 * Wiki のページテンプレート(wiki-template.ts)
 *
 * 管理の権限とアーカイブ、スペースの区分で作れない種類、件数の上限、重複名、並べ替え、
 * ページ作成で使うときの権限と置き換えを、prisma を差し替えて確かめる。
 */

import { DUPLICATED_TEMPLATE_NAME } from '@/lib/board/ticket-template-rule'
import { INVALID_OPERATION, VALIDATION_ERROR } from '@/lib/error'
import { prisma } from '@/lib/prisma'
import { assertWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { WIKI_PAGE_TYPE_NOT_ALLOWED } from '@/lib/wiki/wiki-rule'
import {
  createWikiTemplate,
  deleteWikiTemplate,
  listWikiTemplateOptions,
  listWikiTemplatesForManage,
  moveWikiTemplate,
  renderWikiTemplate,
  updateWikiTemplate,
} from '@/lib/wiki/wiki-template'
import { MAX_WIKI_TEMPLATES_PER_SPACE } from '@/lib/wiki/wiki-template-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiTemplate: ['findMany', 'findFirst', 'findUnique', 'create', 'update', 'delete'],
    user: ['findUnique'],
  }),
)
vi.mock('@/lib/wiki/wiki-access', () => ({ assertWikiSpaceAccess: vi.fn() }))

const actor = { id: 'u1' }
const SPACE_ID = 's1'
const fields = { name: '議事録', title: '{{date}} 定例', content: '# 議題', type: 'page' as const }

const errorTypeOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (e) {
    return (e as { errorType?: string }).errorType
  }
  throw new Error('not rejected')
}

const mockAccess = (access: { type?: 'mixed' | 'design_doc'; archived?: boolean } = {}) =>
  vi.mocked(assertWikiSpaceAccess).mockResolvedValue({ type: 'mixed', archived: false, ...access } as never)

beforeEach(() => {
  vi.clearAllMocks()
  mockAccess()
  vi.mocked(prisma.wikiTemplate.findMany).mockResolvedValue([])
  vi.mocked(prisma.wikiTemplate.findUnique).mockResolvedValue({ spaceId: SPACE_ID } as never)
  vi.mocked(prisma.wikiTemplate.create).mockImplementation((async ({ data }: { data: object }) => ({
    id: 'new',
    ...data,
  })) as never)
  vi.mocked(prisma.wikiTemplate.update).mockImplementation((async ({ data }: { data: object }) => ({
    id: 't1',
    ...data,
  })) as never)
})

describe('createWikiTemplate', () => {
  it('スペース行をロックしてから manage を確かめ、末尾の順で作成者を記録して作る', async () => {
    vi.mocked(prisma.wikiTemplate.findMany).mockResolvedValue([{ order: 0 }, { order: 3 }] as never)

    const template = await createWikiTemplate(actor, { spaceId: SPACE_ID, ...fields })

    expect(template).toMatchObject({ name: '議事録' })
    expect(prisma.wikiTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ spaceId: SPACE_ID, order: 4, createdById: 'u1', updatedById: 'u1' }),
      }),
    )
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'manage', expect.anything())
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assertWikiSpaceAccess).mock.invocationCallOrder[0],
    )
  })

  it('設計書スペースには種類 page のテンプレートを作れない(design_doc は作れる)', async () => {
    mockAccess({ type: 'design_doc' })
    expect(await errorTypeOf(createWikiTemplate(actor, { spaceId: SPACE_ID, ...fields }))).toBe(
      WIKI_PAGE_TYPE_NOT_ALLOWED,
    )
    expect(prisma.wikiTemplate.create).not.toHaveBeenCalled()

    await createWikiTemplate(actor, { spaceId: SPACE_ID, ...fields, type: 'design_doc' })
    expect(prisma.wikiTemplate.create).toHaveBeenCalled()
  })

  it('上限に達していれば作れない', async () => {
    vi.mocked(prisma.wikiTemplate.findMany).mockResolvedValue(
      Array.from({ length: MAX_WIKI_TEMPLATES_PER_SPACE }, (_, order) => ({ order })) as never,
    )
    expect(await errorTypeOf(createWikiTemplate(actor, { spaceId: SPACE_ID, ...fields }))).toBe(INVALID_OPERATION)
    expect(prisma.wikiTemplate.create).not.toHaveBeenCalled()
  })

  it('同じスペースに同名があれば DUPLICATED_TEMPLATE_NAME', async () => {
    vi.mocked(prisma.wikiTemplate.create).mockRejectedValue({ code: 'P2002' })
    expect(await errorTypeOf(createWikiTemplate(actor, { spaceId: SPACE_ID, ...fields }))).toBe(
      DUPLICATED_TEMPLATE_NAME,
    )
  })

  it('アーカイブ済みのスペースでは作れない', async () => {
    mockAccess({ archived: true })
    expect(await errorTypeOf(createWikiTemplate(actor, { spaceId: SPACE_ID, ...fields }))).toBe(INVALID_OPERATION)
    expect(prisma.wikiTemplate.create).not.toHaveBeenCalled()
  })

  it('管理できないスペースでは作れない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(createWikiTemplate(actor, { spaceId: SPACE_ID, ...fields })).rejects.toThrow('denied')
    expect(prisma.wikiTemplate.create).not.toHaveBeenCalled()
  })
})

describe('updateWikiTemplate / deleteWikiTemplate', () => {
  it('テンプレートのスペースで manage を確かめ、更新者を記録する', async () => {
    await updateWikiTemplate(actor, { id: 't1', ...fields })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'manage', expect.anything())
    expect(prisma.wikiTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: expect.objectContaining({ updatedById: 'u1' }) }),
    )
  })

  it('設計書スペースでは種類を page に変えられない', async () => {
    mockAccess({ type: 'design_doc' })
    expect(await errorTypeOf(updateWikiTemplate(actor, { id: 't1', ...fields }))).toBe(WIKI_PAGE_TYPE_NOT_ALLOWED)
    expect(prisma.wikiTemplate.update).not.toHaveBeenCalled()
  })

  it('無いテンプレートは errInvalidOperation', async () => {
    vi.mocked(prisma.wikiTemplate.findUnique).mockResolvedValue(null)
    expect(await errorTypeOf(updateWikiTemplate(actor, { id: 'x', ...fields }))).toBe(INVALID_OPERATION)
    expect(await errorTypeOf(deleteWikiTemplate(actor, 'x'))).toBe(INVALID_OPERATION)
  })

  it('アーカイブ済みのスペースでは更新も削除もできない', async () => {
    mockAccess({ archived: true })
    expect(await errorTypeOf(updateWikiTemplate(actor, { id: 't1', ...fields }))).toBe(INVALID_OPERATION)
    expect(await errorTypeOf(deleteWikiTemplate(actor, 't1'))).toBe(INVALID_OPERATION)
    expect(prisma.wikiTemplate.delete).not.toHaveBeenCalled()
  })

  it('削除する', async () => {
    await deleteWikiTemplate(actor, 't1')
    expect(prisma.wikiTemplate.delete).toHaveBeenCalledWith({ where: { id: 't1' } })
  })
})

describe('moveWikiTemplate', () => {
  const ordered = (ids: string[]) =>
    vi.mocked(prisma.wikiTemplate.findMany).mockResolvedValue(ids.map((id) => ({ id })) as never)
  const writtenOrders = () =>
    vi.mocked(prisma.wikiTemplate.update).mock.calls.map(([arg]) => [arg.where.id, arg.data.order])

  it('今の並びで隣と入れ替え、0 から振り直す', async () => {
    ordered(['a', 'b', 'c'])
    await moveWikiTemplate(actor, 'c', 'up')
    expect(writtenOrders()).toEqual([
      ['a', 0],
      ['c', 1],
      ['b', 2],
    ])
  })

  it('端では動かさない', async () => {
    ordered(['a', 'b'])
    await moveWikiTemplate(actor, 'a', 'up')
    await moveWikiTemplate(actor, 'b', 'down')
    expect(prisma.wikiTemplate.update).not.toHaveBeenCalled()
  })

  it('アーカイブ済みのスペースでは並べ替えられない', async () => {
    mockAccess({ archived: true })
    ordered(['a', 'b'])
    expect(await errorTypeOf(moveWikiTemplate(actor, 'b', 'up'))).toBe(INVALID_OPERATION)
  })
})

describe('一覧', () => {
  it('管理画面の一覧は manage、作成の選択肢は write を要求する', async () => {
    await listWikiTemplatesForManage(actor, SPACE_ID)
    expect(assertWikiSpaceAccess).toHaveBeenLastCalledWith(actor, SPACE_ID, 'manage')
    await listWikiTemplateOptions(actor, SPACE_ID)
    expect(assertWikiSpaceAccess).toHaveBeenLastCalledWith(actor, SPACE_ID, 'write')
    expect(prisma.wikiTemplate.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ select: { id: true, name: true, title: true, type: true } }),
    )
  })
})

describe('renderWikiTemplate', () => {
  const now = new Date('2026-11-30T15:30:00Z')

  beforeEach(() => {
    vi.mocked(prisma.wikiTemplate.findFirst).mockResolvedValue(fields as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: '作成者A', timezone: 'Asia/Tokyo' } as never)
  })

  it('書き込みを確かめてから同じスペースのテンプレートを引き、作成者の設定で置き換える', async () => {
    vi.mocked(prisma.wikiTemplate.findFirst).mockResolvedValue({
      ...fields,
      content: '作成: {{user}} ({{month}})',
    } as never)

    const rendered = await renderWikiTemplate(actor, SPACE_ID, { id: 't1' }, now)

    expect(rendered).toMatchObject({
      name: '議事録',
      title: '2026-12-01 定例',
      content: '作成: 作成者A (2026-12)',
      type: 'page',
    })
    expect(assertWikiSpaceAccess).toHaveBeenCalledWith(actor, SPACE_ID, 'write')
    expect(prisma.wikiTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: SPACE_ID, id: 't1' } }),
    )
  })

  it('タイムゾーン未設定ならサーバーの既定で置き換える', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: '作成者A', timezone: null } as never)
    const rendered = await renderWikiTemplate(actor, SPACE_ID, { id: 't1' }, now)
    // 既定は Asia/Tokyo
    expect(rendered.title).toBe('2026-12-01 定例')
  })

  it('書き込めなければテンプレートを引かない', async () => {
    vi.mocked(assertWikiSpaceAccess).mockRejectedValue(new Error('denied'))
    await expect(renderWikiTemplate(actor, SPACE_ID, { id: 't1' })).rejects.toThrow('denied')
    expect(prisma.wikiTemplate.findFirst).not.toHaveBeenCalled()
  })

  it('ID で見つからなければ(他のスペースのものを含む)errInvalidOperation', async () => {
    vi.mocked(prisma.wikiTemplate.findFirst).mockResolvedValue(null)
    expect(await errorTypeOf(renderWikiTemplate(actor, SPACE_ID, { id: 'other' }))).toBe(INVALID_OPERATION)
  })

  it('名前で見つからなければ、既存の名前を添えて検証エラー', async () => {
    vi.mocked(prisma.wikiTemplate.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.wikiTemplate.findMany).mockResolvedValue([{ name: '議事録' }, { name: '週報' }] as never)

    const promise = renderWikiTemplate(actor, SPACE_ID, { name: '日報' })

    await expect(promise).rejects.toMatchObject({ errorType: VALIDATION_ERROR })
    await expect(promise).rejects.toThrow('Existing templates: 議事録, 週報')
  })
})
