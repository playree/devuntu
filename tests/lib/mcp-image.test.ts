/**
 * 画像ツールの単体テスト
 *
 * HTTP/OAuth を経由せず SDK の InMemoryTransport で入出力だけを見る。
 * ストレージとDBはモックし、添付先ボードの決め方・入力の正規化・認可の落とし方を検証する。
 */

import { assertBoardAccess, assertTicketAccess, getBoardAccess } from '@/lib/board/board'
import { registerImageTools } from '@/lib/mcp/mcp-image'
import { resolveTicketId } from '@/lib/mcp/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { saveContentImage } from '@/lib/storage/attachment'
import { resizeWebp } from '@/lib/storage/image'
import { getObject } from '@/lib/storage/storage'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findAttachment: vi.fn() }))

vi.mock('@/lib/prisma', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prisma')>()),
  prisma: new Proxy(
    {},
    {
      get: (_target, model) =>
        model === 'attachment'
          ? { findUnique: mocks.findAttachment }
          : { findFirst: async () => ({}), findUnique: async () => ({}) },
    },
  ),
}))

vi.mock('@/lib/board/board', () => ({
  assertBoardAccess: vi.fn(),
  assertTicketAccess: vi.fn(),
  getBoardAccess: vi.fn(),
}))

vi.mock('@/lib/mcp/mcp-ticket', () => ({ resolveTicketId: vi.fn() }))
vi.mock('@/lib/storage/attachment', () => ({ saveContentImage: vi.fn() }))
vi.mock('@/lib/storage/storage', () => ({ getObject: vi.fn() }))
vi.mock('@/lib/storage/image', () => ({ resizeWebp: vi.fn(), WEBP_MIME: 'image/webp' }))

const BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860002'
const TICKET_BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860003'
const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'

const auth: ResourceAuth = {
  user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
  scopes: ['mcp'],
  kind: 'oauth',
  clientId: 'test-client',
}

const connectClient = async () => {
  const server = new McpServer({ name: 'devuntu', version: '1.0.0' })
  registerImageTools(server, auth)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return client
}

/** ツールの返り値のうち text ブロックを JSON として読む */
const jsonOf = (result: unknown) => {
  const content = (result as { content: { type: string; text?: string }[] }).content
  return JSON.parse(content.find((block) => block.type === 'text')?.text ?? '{}')
}

const pngBase64 = Buffer.from('dummy-png-bytes').toString('base64')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertBoardAccess).mockResolvedValue({ boardId: BOARD_ID, archived: false } as never)
  vi.mocked(assertTicketAccess).mockResolvedValue({ boardId: TICKET_BOARD_ID } as never)
  vi.mocked(resolveTicketId).mockResolvedValue('ticket-1')
  vi.mocked(getBoardAccess).mockResolvedValue({ boardId: BOARD_ID } as never)
  vi.mocked(saveContentImage).mockResolvedValue({ url: `/api/upload/${KEY}`, key: KEY, size: 100 })
  vi.mocked(resizeWebp).mockResolvedValue(Buffer.from('resized'))
  mocks.findAttachment.mockResolvedValue({ boardId: BOARD_ID, originalName: 'shot.png', size: 100 })
  // ストリームは一度しか読めないので呼び出しごとに作り直す
  vi.mocked(getObject).mockImplementation(async () => ({
    body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
    contentLength: 3,
  }))
})

describe('registerImageTools', () => {
  it('画像の3ツールが tools/list に現れる', async () => {
    const { tools } = await (await connectClient()).listTools()

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['create_image_upload_token', 'upload_image', 'get_image']),
    )
  })
})

describe('create_image_upload_token', () => {
  it('boardId 指定でアップロードURLとトークンを返す', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'create_image_upload_token', arguments: { boardId: BOARD_ID } })

    expect(assertBoardAccess).toHaveBeenCalledWith(auth.user, BOARD_ID, 'view')
    const json = jsonOf(result)
    expect(json.uploadUrl).toBe('http://localhost:3000/api/upload')
    expect(json.boardId).toBe(BOARD_ID)
    expect(json.token).toEqual(expect.any(String))
    expect(json.curl).toContain(`Bearer ${json.token}`)
  })

  it('ticketId 指定ではチケットの編集権限を通してボードを決める', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'create_image_upload_token', arguments: { ticketId: 'ABC-42' } })

    expect(resolveTicketId).toHaveBeenCalledWith(auth, 'ABC-42')
    expect(assertTicketAccess).toHaveBeenCalledWith(auth.user, 'ticket-1', 'edit')
    expect(jsonOf(result).boardId).toBe(TICKET_BOARD_ID)
  })

  it('アーカイブ済みボードへの添付を拒否する', async () => {
    vi.mocked(assertBoardAccess).mockResolvedValue({ boardId: BOARD_ID, archived: true } as never)

    const result = await (
      await connectClient()
    ).callTool({ name: 'create_image_upload_token', arguments: { boardId: BOARD_ID } })

    expect(result.isError).toBe(true)
  })

  it('boardId と ticketId の同時指定・両方省略を拒否する', async () => {
    const client = await connectClient()

    const both = await client.callTool({
      name: 'create_image_upload_token',
      arguments: { boardId: BOARD_ID, ticketId: 'ABC-42' },
    })
    const neither = await client.callTool({ name: 'create_image_upload_token', arguments: {} })

    expect(both.isError).toBe(true)
    expect(neither.isError).toBe(true)
  })
})

describe('upload_image', () => {
  const args = { boardId: BOARD_ID, filename: 'shot.png', mimeType: 'image/png' }

  it('base64 を復号して保存し、本文へ貼る Markdown を返す', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'upload_image', arguments: { ...args, data: pngBase64 } })

    const [file, target] = vi.mocked(saveContentImage).mock.calls[0] ?? []
    expect(target).toEqual({ boardId: BOARD_ID, userId: 'u1' })
    expect(file?.name).toBe('shot.png')
    expect(await file?.text()).toBe('dummy-png-bytes')
    expect(jsonOf(result)).toEqual({ url: `/api/upload/${KEY}`, markdown: `![shot.png](/api/upload/${KEY})` })
  })

  it('data URL 形式の接頭辞を取り除く', async () => {
    await (
      await connectClient()
    ).callTool({ name: 'upload_image', arguments: { ...args, data: `data:image/png;base64,${pngBase64}` } })

    const [file] = vi.mocked(saveContentImage).mock.calls[0] ?? []
    expect(await file?.text()).toBe('dummy-png-bytes')
  })

  it('上限を超える base64 は復号せずに拒否する', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'upload_image', arguments: { ...args, data: 'a'.repeat(512 * 1024 + 1) } })

    expect(result.isError).toBe(true)
    expect(saveContentImage).not.toHaveBeenCalled()
  })

  it('許可外の形式を拒否する', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'upload_image', arguments: { ...args, mimeType: 'image/svg+xml', data: pngBase64 } })

    expect(result.isError).toBe(true)
    expect(saveContentImage).not.toHaveBeenCalled()
  })
})

describe('get_image', () => {
  it('URL でもキーそのものでも同じ画像を返す', async () => {
    const client = await connectClient()

    const byUrl = await client.callTool({ name: 'get_image', arguments: { image: `/api/upload/${KEY}` } })
    const byKey = await client.callTool({ name: 'get_image', arguments: { image: KEY } })

    expect(mocks.findAttachment).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { key: KEY } }))
    expect(mocks.findAttachment).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { key: KEY } }))
    expect(byUrl.content).toEqual(byKey.content)
  })

  it('画像コンテンツと付随情報を返す', async () => {
    const result = await (await connectClient()).callTool({ name: 'get_image', arguments: { image: KEY } })

    expect((result.content as unknown[])[0]).toEqual({
      type: 'image',
      mimeType: 'image/webp',
      data: Buffer.from('resized').toString('base64'),
    })
    expect(jsonOf(result)).toMatchObject({ key: KEY, originalName: 'shot.png' })
  })

  it('maxSize は既定 1024 で、指定するとそのまま縮小に渡る', async () => {
    const client = await connectClient()

    await client.callTool({ name: 'get_image', arguments: { image: KEY } })
    expect(resizeWebp).toHaveBeenLastCalledWith(expect.any(Uint8Array), 1024)

    await client.callTool({ name: 'get_image', arguments: { image: KEY, maxSize: 512 } })
    expect(resizeWebp).toHaveBeenLastCalledWith(expect.any(Uint8Array), 512)
  })

  it('キーの形式が不正なものはストレージを見ずに拒否する', async () => {
    const client = await connectClient()

    // uuidv7 + 許可拡張子のホワイトリストなので、二重拡張子や UUIDv4 も通らない
    for (const image of ['../../etc/passwd', 'not-a-key', `${KEY}.svg`, '019eef64-6cc1-48f1-8f50-1ef86986289a.webp']) {
      expect((await client.callTool({ name: 'get_image', arguments: { image } })).isError).toBe(true)
    }
    expect(getObject).not.toHaveBeenCalled()
  })

  it('ボードのアクセス権が無い場合は未存在と同じエラーにする', async () => {
    const client = await connectClient()
    vi.mocked(getBoardAccess).mockResolvedValue(null)
    const denied = await client.callTool({ name: 'get_image', arguments: { image: KEY } })

    mocks.findAttachment.mockResolvedValue(null)
    const missing = await client.callTool({ name: 'get_image', arguments: { image: KEY } })

    expect(denied.isError).toBe(true)
    expect(denied.content).toEqual(missing.content)
  })

  it('ボードに属さない添付は誰でも読める', async () => {
    mocks.findAttachment.mockResolvedValue({ boardId: null, originalName: 'icon.png', size: 10 })

    const result = await (await connectClient()).callTool({ name: 'get_image', arguments: { image: KEY } })

    expect(getBoardAccess).not.toHaveBeenCalled()
    expect(result.isError).toBeFalsy()
  })
})
