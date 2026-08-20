/**
 * HTTP/OAuth を経由せず、SDK の InMemoryTransport でツールの入出力だけを検証する。
 *
 * get_ticket/search_tickets は `@/lib/mcp-ticket` を vi.mock し、ツールへの登録・引数の受け渡し・
 * 返り値の text 化のみを見る(DB を伴う実際のクエリはこのリポジトリの他の Server Action と同様に
 * 単体テストの対象外としている)。
 */

import { createDevuntuMcpServer } from '@/lib/mcp-server'
import { getTicketForMcp, searchTicketsForMcp } from '@/lib/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth-resource'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mcp-ticket', () => ({
  getTicketForMcp: vi.fn(),
  searchTicketsForMcp: vi.fn(),
}))

const auth: ResourceAuth = {
  user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
  scopes: ['mcp'],
  clientId: 'test-client',
}

const connectClient = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createDevuntuMcpServer(auth).connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return client
}

describe('createDevuntuMcpServer', () => {
  it('ping/echo/get_ticket/search_tickets が tools/list に現れる', async () => {
    const { tools } = await (await connectClient()).listTools()
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['ping', 'echo', 'get_ticket', 'search_tickets']),
    )
  })

  it('ping は認可済みユーザーの情報を返す', async () => {
    const result = await (await connectClient()).callTool({ name: 'ping', arguments: {} })
    expect(result.content).toEqual([{ type: 'text', text: `pong: ${auth.user.email}` }])
  })

  it('echo は入力をそのまま返す', async () => {
    const result = await (await connectClient()).callTool({ name: 'echo', arguments: { message: 'hello' } })
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('get_ticket は auth と ticketId を渡し、結果をJSONテキストとして返す', async () => {
    vi.mocked(getTicketForMcp).mockResolvedValueOnce({ title: 'テストチケット' } as never)

    const result = await (
      await connectClient()
    ).callTool({
      name: 'get_ticket',
      arguments: { ticketId: 'ABC-1' },
    })

    expect(getTicketForMcp).toHaveBeenCalledWith(auth, 'ABC-1')
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ title: 'テストチケット' }, null, 2) }])
  })

  it('search_tickets は検索条件を渡し、結果をJSONテキストとして返す', async () => {
    vi.mocked(searchTicketsForMcp).mockResolvedValueOnce([{ title: 'テストチケット' } as never])

    const result = await (
      await connectClient()
    ).callTool({
      name: 'search_tickets',
      arguments: { keyword: 'テスト', status: ['todo'] },
    })

    expect(searchTicketsForMcp).toHaveBeenCalledWith(auth, { keyword: 'テスト', status: ['todo'] })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify([{ title: 'テストチケット' }], null, 2) }])
  })
})
