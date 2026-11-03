/**
 * ファイルツールの単体テスト
 *
 * HTTP/OAuth を経由せず SDK の InMemoryTransport で入出力だけを見る。
 * ストレージとDBはモックし、テキストとして返すかダウンロードさせるかの振り分けと認可の落とし方を検証する。
 */

import { assertBoardAccess, canViewAttachment } from '@/lib/board/board-access'
import { decodeText, MAX_INLINE_TEXT_SIZE, registerFileTools } from '@/lib/mcp/mcp-file'
import { prisma } from '@/lib/prisma'
import { getObject } from '@/lib/storage/storage'
import { verifyDownloadToken, verifyUploadToken } from '@/lib/storage/upload-token'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectMcpServer, jsonOf } from '../../helpers/mcp-client'
import { oauthAuth } from '../../helpers/resource-auth'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma(
    { attachment: ['findUnique'], user: ['findUnique'], uploadNonce: ['create', 'deleteMany'] },
    { stubOthers: true },
  ),
)

vi.mock('@/lib/board/board-access', () => ({
  assertBoardAccess: vi.fn(),
  assertTicketAccess: vi.fn(),
  canViewAttachment: vi.fn(),
  getBoardAccess: vi.fn(async () => ({ boardId: '019eef64-6cc1-78f1-8f50-1ef869860002', archived: false })),
}))

vi.mock('@/lib/mcp/mcp-ticket', () => ({ resolveTicketId: vi.fn() }))
vi.mock('@/lib/storage/attachment', () => ({ saveContentImage: vi.fn() }))
vi.mock('@/lib/storage/storage', () => ({ getObject: vi.fn() }))
vi.mock('@/lib/storage/image', () => ({ resizeWebp: vi.fn(), WEBP_MIME: 'image/webp' }))

const BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860002'
const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.log'

const auth = oauthAuth()

const connectClient = () => {
  const server = new McpServer({ name: 'devuntu', version: '1.0.0' })
  registerFileTools(server, auth)
  return connectMcpServer(server)
}

const findAttachment = vi.mocked(prisma.attachment.findUnique)

const mockObject = (bytes: Uint8Array) =>
  vi.mocked(getObject).mockImplementation(async () => ({
    body: new Blob([bytes as BlobPart]).stream(),
    contentLength: bytes.byteLength,
  }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertBoardAccess).mockResolvedValue({ boardId: BOARD_ID, archived: false } as never)
  vi.mocked(canViewAttachment).mockResolvedValue(true)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', role: null, banned: false } as never)
  vi.mocked(prisma.uploadNonce.create).mockResolvedValue({ jti: 'x' } as never)
  vi.mocked(prisma.uploadNonce.deleteMany).mockResolvedValue({ count: 0 })
  findAttachment.mockResolvedValue({
    boardId: BOARD_ID,
    originalName: 'build.log',
    size: 11,
    mimeType: 'text/plain',
  } as never)
  mockObject(new TextEncoder().encode('hello world'))
})

describe('decodeText', () => {
  it('UTF-8 として読めるものは文字列にする', () => {
    expect(decodeText(new TextEncoder().encode('ログ\nline2'))).toBe('ログ\nline2')
  })

  it('UTF-8 として不正なもの・NUL を含むものは null', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull()
    expect(decodeText(new Uint8Array([0x61, 0x00, 0x62]))).toBeNull()
  })
})

describe('create_file_upload_token', () => {
  it('ファイル用の curl と上限を返し、トークンはアップロードに使える', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'create_file_upload_token', arguments: { boardId: BOARD_ID } })

    expect(assertBoardAccess).toHaveBeenCalledWith(auth.user, BOARD_ID, 'write')
    const json = jsonOf(result)
    expect(json.uploadUrl).toBe('http://localhost:3000/api/upload?kind=file')
    expect(json.curl).toContain(json.uploadUrl)
    expect(json.maxSizeMb).toBe(10)
    expect(await verifyUploadToken(json.token)).toEqual({ userId: 'u1', boardId: BOARD_ID })
  })
})

describe('get_file', () => {
  it('小さいテキストは中身を返す', async () => {
    const result = await (
      await connectClient()
    ).callTool({ name: 'get_file', arguments: { file: `/api/upload/${KEY}` } })

    expect(jsonOf(result)).toEqual({
      key: KEY,
      name: 'build.log',
      size: 11,
      mimeType: 'text/plain',
      text: 'hello world',
    })
  })

  it('バイナリはダウンロード用のトークンと curl を返す', async () => {
    findAttachment.mockResolvedValue({
      boardId: BOARD_ID,
      originalName: 'a.zip',
      size: 3,
      mimeType: 'application/zip',
    } as never)
    mockObject(new Uint8Array([0x50, 0x4b, 0x00]))

    const json = jsonOf(await (await connectClient()).callTool({ name: 'get_file', arguments: { file: KEY } }))

    expect(json.text).toBeUndefined()
    expect(json.downloadUrl).toBe(`http://localhost:3000/api/upload/${KEY}`)
    expect(json.curl).toContain(`Bearer ${json.token}`)
    expect(await verifyDownloadToken(json.token, KEY)).toEqual({ id: 'u1', role: null })
  })

  it('上限を超える大きさなら中身を読まずにダウンロードさせる', async () => {
    findAttachment.mockResolvedValue({
      boardId: BOARD_ID,
      originalName: 'big.log',
      size: MAX_INLINE_TEXT_SIZE + 1,
      mimeType: 'text/plain',
    } as never)

    const json = jsonOf(await (await connectClient()).callTool({ name: 'get_file', arguments: { file: KEY } }))

    expect(getObject).not.toHaveBeenCalled()
    expect(json.token).toEqual(expect.any(String))
  })

  it('見られない添付は未存在と同じエラーにする', async () => {
    vi.mocked(canViewAttachment).mockResolvedValue(false)

    const result = await (await connectClient()).callTool({ name: 'get_file', arguments: { file: KEY } })

    expect(result.isError).toBe(true)
    expect(getObject).not.toHaveBeenCalled()
  })

  it('形式が不正なキーを拒否する', async () => {
    const result = await (await connectClient()).callTool({ name: 'get_file', arguments: { file: '../etc/passwd' } })

    expect(result.isError).toBe(true)
    expect(findAttachment).not.toHaveBeenCalled()
  })
})
