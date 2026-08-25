/**
 * HTTP/OAuth を経由せず、SDK の InMemoryTransport でツールの入出力だけを検証する。
 *
 * get_ticket/search_tickets は `@/lib/mcp-ticket` を vi.mock し、ツールへの登録・引数の受け渡し・
 * 返り値の text 化のみを見る(DB を伴う実際のクエリはこのリポジトリの他の Server Action と同様に
 * 単体テストの対象外としている)。
 */

import { createDevuntuMcpServer } from '@/lib/mcp-server'
import {
  addTicketCommentForMcp,
  createTicketForMcp,
  deleteTicketCommentForMcp,
  deleteTicketForMcp,
  getTicketForMcp,
  searchTicketsForMcp,
  updateTicketCommentForMcp,
  updateTicketForMcp,
} from '@/lib/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mcp-ticket', () => ({
  MCP_ASSIGNEE_ME: 'me',
  getTicketForMcp: vi.fn(),
  searchTicketsForMcp: vi.fn(),
  createTicketForMcp: vi.fn(),
  updateTicketForMcp: vi.fn(),
  deleteTicketForMcp: vi.fn(),
  addTicketCommentForMcp: vi.fn(),
  updateTicketCommentForMcp: vi.fn(),
  deleteTicketCommentForMcp: vi.fn(),
}))

const auth: ResourceAuth = {
  user: { id: 'u1', name: 'tester', email: 'test@example.com', role: null },
  scopes: ['mcp'],
  kind: 'oauth',
  clientId: 'test-client',
}

/** エージェント用の長期トークンで認可された場合。`clientId` は AgentToken の id */
const agentAuth: ResourceAuth = {
  user: { id: 'a1', name: 'agent', email: 'agent@agents.invalid', role: null },
  scopes: ['mcp'],
  kind: 'agent',
  clientId: 'token-1',
}

const connectClient = async (resourceAuth: ResourceAuth = auth) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createDevuntuMcpServer(resourceAuth).connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return client
}

describe('createDevuntuMcpServer', () => {
  it('全ツールが tools/list に現れる', async () => {
    const { tools } = await (await connectClient()).listTools()
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'ping',
        'echo',
        'get_ticket',
        'search_tickets',
        'create_ticket',
        'update_ticket',
        'delete_ticket',
        'add_ticket_comment',
        'update_ticket_comment',
        'delete_ticket_comment',
      ]),
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

  it('search_tickets は担当者の指定も渡す(エージェントが自分の担当を引く経路)', async () => {
    vi.mocked(searchTicketsForMcp).mockResolvedValueOnce([])

    await (
      await connectClient(agentAuth)
    ).callTool({
      name: 'search_tickets',
      arguments: { assignee: 'me' },
    })

    expect(searchTicketsForMcp).toHaveBeenCalledWith(agentAuth, { assignee: 'me' })
  })

  it('search_tickets の担当者はセンチネルか userId のみ受け付ける', async () => {
    vi.mocked(searchTicketsForMcp).mockClear()

    const result = await (
      await connectClient(agentAuth)
    ).callTool({
      name: 'search_tickets',
      arguments: { assignee: 'anyone' },
    })

    expect(result.isError).toBe(true)
    expect(searchTicketsForMcp).not.toHaveBeenCalled()
  })

  it('create_ticket は入力をそのまま渡し、結果をJSONテキストとして返す', async () => {
    vi.mocked(createTicketForMcp).mockResolvedValueOnce({
      id: 't1',
      displayId: 'ABC-1',
      title: '新規チケット',
    } as never)

    const result = await (
      await connectClient()
    ).callTool({
      name: 'create_ticket',
      arguments: { boardId: 'b1', title: '新規チケット' },
    })

    expect(createTicketForMcp).toHaveBeenCalledWith(auth, {
      boardId: 'b1',
      title: '新規チケット',
      status: 'todo',
      priority: 'medium',
    })
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ id: 't1', displayId: 'ABC-1', title: '新規チケット' }, null, 2) },
    ])
  })

  it('update_ticket は ticketId を分離して残りをMCPロジックへ渡す', async () => {
    vi.mocked(updateTicketForMcp).mockResolvedValueOnce({ id: 't1', title: '更新後' } as never)

    const result = await (
      await connectClient()
    ).callTool({
      name: 'update_ticket',
      arguments: { ticketId: 'ABC-1', title: '更新後' },
    })

    expect(updateTicketForMcp).toHaveBeenCalledWith(auth, 'ABC-1', { title: '更新後' })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 't1', title: '更新後' }, null, 2) }])
  })

  it('delete_ticket は ticketId を渡し、結果をJSONテキストとして返す', async () => {
    vi.mocked(deleteTicketForMcp).mockResolvedValueOnce({ id: 't1' } as never)

    const result = await (
      await connectClient()
    ).callTool({
      name: 'delete_ticket',
      arguments: { ticketId: 'ABC-1' },
    })

    expect(deleteTicketForMcp).toHaveBeenCalledWith(auth, 'ABC-1')
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 't1' }, null, 2) }])
  })

  it('add_ticket_comment は ticketId と content を渡す', async () => {
    vi.mocked(addTicketCommentForMcp).mockResolvedValueOnce({ id: 'c1' } as never)

    const result = await (
      await connectClient()
    ).callTool({
      name: 'add_ticket_comment',
      arguments: { ticketId: 'ABC-1', content: 'コメント' },
    })

    expect(addTicketCommentForMcp).toHaveBeenCalledWith(auth, 'ABC-1', 'コメント', undefined, undefined)
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 'c1' }, null, 2) }])
  })

  it('add_ticket_comment は type と parentId も渡す', async () => {
    vi.mocked(addTicketCommentForMcp).mockResolvedValueOnce({ id: 'c1' } as never)

    await (
      await connectClient()
    ).callTool({
      name: 'add_ticket_comment',
      arguments: {
        ticketId: 'ABC-1',
        content: 'プラン',
        type: 'plan',
        parentId: '0195c1e0-0000-7000-8000-000000000001',
      },
    })

    expect(addTicketCommentForMcp).toHaveBeenCalledWith(
      auth,
      'ABC-1',
      'プラン',
      'plan',
      '0195c1e0-0000-7000-8000-000000000001',
    )
  })

  it('update_ticket_comment は commentId と content を渡す', async () => {
    vi.mocked(updateTicketCommentForMcp).mockResolvedValueOnce({ id: 'c1' } as never)

    const result = await (
      await connectClient()
    ).callTool({
      name: 'update_ticket_comment',
      arguments: { commentId: '0195c1e0-0000-7000-8000-000000000001', content: 'コメント編集後' },
    })

    expect(updateTicketCommentForMcp).toHaveBeenCalledWith(
      auth,
      '0195c1e0-0000-7000-8000-000000000001',
      'コメント編集後',
    )
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 'c1' }, null, 2) }])
  })

  it('delete_ticket_comment は commentId を渡す', async () => {
    vi.mocked(deleteTicketCommentForMcp).mockResolvedValueOnce({ id: 'c1' } as never)

    const result = await (
      await connectClient()
    ).callTool({
      name: 'delete_ticket_comment',
      arguments: { commentId: '0195c1e0-0000-7000-8000-000000000001' },
    })

    expect(deleteTicketCommentForMcp).toHaveBeenCalledWith(auth, '0195c1e0-0000-7000-8000-000000000001')
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 'c1' }, null, 2) }])
  })
})
