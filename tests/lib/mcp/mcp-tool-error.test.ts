import { errValidation } from '@/lib/error'
import { logger } from '@/lib/logger'
import { guardMcpToolErrors, MCP_INTERNAL_ERROR_MESSAGE } from '@/lib/mcp/mcp-tool-error'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { connectMcpServer } from '../../helpers/mcp-client'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const INTERNAL =
  'Invalid `prisma.ticket.create()` invocation: Unique constraint failed on the fields: (`boardId`,`number`)'

const connect = async (handler: () => Promise<never>) => {
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  guardMcpToolErrors(server)
  server.registerTool('fail', { description: 'fails' }, handler)
  server.registerTool(
    'echo',
    { description: 'echo', inputSchema: z.strictObject({ message: z.string().min(1) }) },
    async ({ message }) => ({ content: [{ type: 'text' as const, text: message }] }),
  )
  return connectMcpServer(server)
}

describe('guardMcpToolErrors', () => {
  beforeEach(() => {
    vi.mocked(logger.error).mockClear()
  })

  it('想定外の例外はログに残し、クライアントには固定の文言だけを返す', async () => {
    const client = await connect(async () => {
      throw new Error(INTERNAL)
    })

    const result = await client.callTool({ name: 'fail', arguments: {} })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: MCP_INTERNAL_ERROR_MESSAGE }])
    expect(JSON.stringify(result.content)).not.toContain('prisma')
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'fail', err: expect.objectContaining({ message: INTERNAL }) }),
      'mcp tool failed',
    )
  })

  it('ClientError は理由と対処を伝えるためメッセージをそのまま返し、エラーログは出さない', async () => {
    const client = await connect(async () => {
      throw errValidation('Specify exactly one of ticketId or boardId')
    })

    const result = await client.callTool({ name: 'fail', arguments: {} })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Specify exactly one of ticketId or boardId')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('入力スキーマの検証エラーは従来どおり内容を返す', async () => {
    const client = await connect(async () => {
      throw new Error(INTERNAL)
    })

    const result = await client.callTool({ name: 'echo', arguments: { message: '' } })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('message')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('正常な戻り値はそのまま返す', async () => {
    const client = await connect(async () => {
      throw new Error(INTERNAL)
    })

    const result = await client.callTool({ name: 'echo', arguments: { message: 'hello' } })

    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
  })
})
