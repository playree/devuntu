/**
 * HTTP/OAuth を経由せず、SDK の InMemoryTransport でツールの入出力だけを検証する。
 *
 * get_ticket/search_tickets は `@/lib/mcp-ticket` を vi.mock し、ツールへの登録・引数の受け渡し・
 * 返り値の text 化のみを見る(DB を伴う実際のクエリはこのリポジトリの他の Server Action と同様に
 * 単体テストの対象外としている)。
 */

import { getBoardForMcp, listBoardsForMcp } from '@/lib/mcp/mcp-board'
import {
  addTicketCommentForMcp,
  createTicketForMcp,
  deleteTicketCommentForMcp,
  deleteTicketForMcp,
  getTicketForMcp,
  linkTicketArtifactForMcp,
  searchTicketsForMcp,
  unlinkTicketArtifactForMcp,
  updateTicketCommentForMcp,
  updateTicketForMcp,
} from '@/lib/mcp/mcp-ticket'
import { describe, expect, it, vi } from 'vitest'
import { connectDevuntuMcp } from '../../helpers/mcp-client'
import * as fakeAuth from '../../helpers/resource-auth'

vi.mock('@/lib/mcp/mcp-board', () => ({
  listBoardsForMcp: vi.fn(),
  getBoardForMcp: vi.fn(),
}))

vi.mock('@/lib/mcp/mcp-ticket', () => ({
  MCP_ASSIGNEE_ME: 'me',
  getTicketForMcp: vi.fn(),
  searchTicketsForMcp: vi.fn(),
  createTicketForMcp: vi.fn(),
  updateTicketForMcp: vi.fn(),
  deleteTicketForMcp: vi.fn(),
  addTicketCommentForMcp: vi.fn(),
  updateTicketCommentForMcp: vi.fn(),
  deleteTicketCommentForMcp: vi.fn(),
  linkTicketArtifactForMcp: vi.fn(),
  unlinkTicketArtifactForMcp: vi.fn(),
}))

const auth = fakeAuth.oauthAuth()
const agentAuth = fakeAuth.agentAuth()
const patAuth = fakeAuth.patAuth()

describe('createDevuntuMcpServer', () => {
  it('全ツールが tools/list に現れる', async () => {
    const { tools } = await (await connectDevuntuMcp()).listTools()
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'ping',
        'echo',
        'list_boards',
        'get_board',
        'get_ticket',
        'search_tickets',
        'create_ticket',
        'update_ticket',
        'delete_ticket',
        'add_ticket_comment',
        'update_ticket_comment',
        'delete_ticket_comment',
        'link_ticket_artifact',
        'unlink_ticket_artifact',
        'create_image_upload_token',
        'upload_image',
        'get_image',
      ]),
    )
  })

  it('サーバー名は人間の経路(OAuth / ユーザートークン)では devuntu、エージェントだけ devuntu-agent', async () => {
    expect((await connectDevuntuMcp()).getServerVersion()?.name).toBe('devuntu')
    expect((await connectDevuntuMcp(patAuth)).getServerVersion()?.name).toBe('devuntu')
    expect((await connectDevuntuMcp(agentAuth)).getServerVersion()?.name).toBe('devuntu-agent')
  })

  it('初期化応答の instructions で対応の作法を伝える(エージェントには自動運用の手順を優先させる)', async () => {
    for (const humanAuth of [auth, patAuth]) {
      const instructions = (await connectDevuntuMcp(humanAuth)).getInstructions() ?? ''
      expect(instructions).toContain('type=plan')
      expect(instructions).toContain('type=report')
      expect(instructions).toContain('link_ticket_artifact')
      expect(instructions).toContain('status を doing')
    }

    const agentInstructions = (await connectDevuntuMcp(agentAuth)).getInstructions() ?? ''
    expect(agentInstructions).toContain('get_agent_task')
    expect(agentInstructions).not.toContain('status を doing')
  })

  it('ユーザートークンの接続でも共通ツールは登録される', async () => {
    const { tools } = await (await connectDevuntuMcp(patAuth)).listTools()
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'ping',
        'list_boards',
        'get_ticket',
        'search_tickets',
        'get_image',
        'get_agent_setup_guide',
        'link_ticket_artifact',
      ]),
    )
  })

  it('ping は認可済みユーザーの情報を返す', async () => {
    const result = await (await connectDevuntuMcp()).callTool({ name: 'ping', arguments: {} })
    expect(result.content).toEqual([{ type: 'text', text: `pong: ${auth.user.email}` }])
  })

  it('echo は入力をそのまま返す', async () => {
    const result = await (await connectDevuntuMcp()).callTool({ name: 'echo', arguments: { message: 'hello' } })
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('list_boards は auth を渡し、結果をJSONテキストとして返す', async () => {
    vi.mocked(listBoardsForMcp).mockResolvedValueOnce([{ key: 'ABC', name: 'テストボード' } as never])

    const result = await (await connectDevuntuMcp()).callTool({ name: 'list_boards', arguments: {} })

    expect(listBoardsForMcp).toHaveBeenCalledWith(auth, { includeArchived: undefined })
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify([{ key: 'ABC', name: 'テストボード' }], null, 2) },
    ])
  })

  it('list_boards は includeArchived を渡す', async () => {
    vi.mocked(listBoardsForMcp).mockResolvedValueOnce([])

    await (await connectDevuntuMcp()).callTool({ name: 'list_boards', arguments: { includeArchived: true } })

    expect(listBoardsForMcp).toHaveBeenCalledWith(auth, { includeArchived: true })
  })

  it('get_board は boardId をそのまま渡す(ボードキーの解決はMCPロジック側)', async () => {
    vi.mocked(getBoardForMcp).mockResolvedValueOnce({ key: 'ABC', members: [], tags: [] } as never)

    const result = await (await connectDevuntuMcp()).callTool({ name: 'get_board', arguments: { boardId: 'ABC' } })

    expect(getBoardForMcp).toHaveBeenCalledWith(auth, 'ABC')
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ key: 'ABC', members: [], tags: [] }, null, 2) },
    ])
  })

  it('get_ticket は auth と ticketId を渡し、結果をJSONテキストとして返す', async () => {
    vi.mocked(getTicketForMcp).mockResolvedValueOnce({ title: 'テストチケット' } as never)

    const result = await (
      await connectDevuntuMcp()
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
      await connectDevuntuMcp()
    ).callTool({
      name: 'search_tickets',
      arguments: { keyword: 'テスト', status: ['todo'] },
    })

    // 未指定の条件は Web の検索スキーマ(scTicketSearch)の既定値で埋まる
    expect(searchTicketsForMcp).toHaveBeenCalledWith(auth, {
      keyword: 'テスト',
      status: ['todo'],
      priority: [],
      tags: [],
    })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify([{ title: 'テストチケット' }], null, 2) }])
  })

  it('search_tickets は担当者の指定も渡す(エージェントが自分の担当を引く経路)', async () => {
    vi.mocked(searchTicketsForMcp).mockResolvedValueOnce([])

    await (
      await connectDevuntuMcp(agentAuth)
    ).callTool({
      name: 'search_tickets',
      arguments: { assignee: 'me' },
    })

    expect(searchTicketsForMcp).toHaveBeenCalledWith(agentAuth, {
      assignee: 'me',
      keyword: '',
      status: [],
      priority: [],
      tags: [],
    })
  })

  it('search_tickets の担当者はセンチネルか userId のみ受け付ける', async () => {
    vi.mocked(searchTicketsForMcp).mockClear()

    const result = await (
      await connectDevuntuMcp(agentAuth)
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
      await connectDevuntuMcp()
    ).callTool({
      name: 'create_ticket',
      arguments: { boardId: 'b1', title: '新規チケット' },
    })

    expect(createTicketForMcp).toHaveBeenCalledWith(auth, {
      boardId: 'b1',
      title: '新規チケット',
      status: 'todo',
      priority: 'medium',
      tagIds: [],
    })
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ id: 't1', displayId: 'ABC-1', title: '新規チケット' }, null, 2) },
    ])
  })

  it('update_ticket は ticketId を分離して残りをMCPロジックへ渡す', async () => {
    vi.mocked(updateTicketForMcp).mockResolvedValueOnce({ id: 't1', title: '更新後' } as never)

    const result = await (
      await connectDevuntuMcp()
    ).callTool({
      name: 'update_ticket',
      arguments: { ticketId: 'ABC-1', title: '更新後' },
    })

    expect(updateTicketForMcp).toHaveBeenCalledWith(auth, 'ABC-1', { title: '更新後' })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 't1', title: '更新後' }, null, 2) }])
  })

  it('受け入れ条件は acceptanceCriteria で受け、criteria として渡す', async () => {
    vi.mocked(createTicketForMcp).mockResolvedValueOnce({ id: 't1' } as never)
    vi.mocked(updateTicketForMcp).mockResolvedValueOnce({ id: 't1' } as never)
    const client = await connectDevuntuMcp()

    await client.callTool({
      name: 'create_ticket',
      arguments: { boardId: 'b1', title: '新規', acceptanceCriteria: ['条件1', '条件2'] },
    })
    await client.callTool({
      name: 'update_ticket',
      arguments: { ticketId: 'ABC-1', acceptanceCriteria: [{ text: '条件3' }] },
    })

    expect(createTicketForMcp).toHaveBeenCalledWith(auth, expect.objectContaining({ criteria: ['条件1', '条件2'] }))
    expect(vi.mocked(createTicketForMcp).mock.calls[0][1]).not.toHaveProperty('acceptanceCriteria')
    expect(updateTicketForMcp).toHaveBeenCalledWith(auth, 'ABC-1', { criteria: [{ text: '条件3' }] })
  })

  it('delete_ticket は ticketId を渡し、結果をJSONテキストとして返す', async () => {
    vi.mocked(deleteTicketForMcp).mockResolvedValueOnce({ id: 't1' } as never)

    const result = await (
      await connectDevuntuMcp()
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
      await connectDevuntuMcp()
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
      await connectDevuntuMcp()
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
      await connectDevuntuMcp()
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
      await connectDevuntuMcp()
    ).callTool({
      name: 'delete_ticket_comment',
      arguments: { commentId: '0195c1e0-0000-7000-8000-000000000001' },
    })

    expect(deleteTicketCommentForMcp).toHaveBeenCalledWith(auth, '0195c1e0-0000-7000-8000-000000000001')
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 'c1' }, null, 2) }])
  })

  it('link_ticket_artifact は ticketId と url を渡す', async () => {
    vi.mocked(linkTicketArtifactForMcp).mockResolvedValueOnce({ id: 'l1' })

    const result = await (
      await connectDevuntuMcp(agentAuth)
    ).callTool({
      name: 'link_ticket_artifact',
      arguments: { ticketId: 'ABC-1', url: 'https://github.com/owner/repo/pull/12' },
    })

    expect(linkTicketArtifactForMcp).toHaveBeenCalledWith(agentAuth, 'ABC-1', 'https://github.com/owner/repo/pull/12')
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ id: 'l1' }, null, 2) }])
  })

  it('link_ticket_artifact は GitHub / GitLab 以外の URL を受け付けない', async () => {
    const result = await (
      await connectDevuntuMcp()
    ).callTool({
      name: 'link_ticket_artifact',
      arguments: { ticketId: 'ABC-1', url: 'https://example.com/owner/repo/pull/12' },
    })

    expect(result.isError).toBe(true)
    expect(linkTicketArtifactForMcp).not.toHaveBeenCalled()
  })

  it('unlink_ticket_artifact は linkId を渡す', async () => {
    vi.mocked(unlinkTicketArtifactForMcp).mockResolvedValueOnce({ id: 'l1' })

    await (
      await connectDevuntuMcp()
    ).callTool({
      name: 'unlink_ticket_artifact',
      arguments: { linkId: '0195c1e0-0000-7000-8000-000000000001' },
    })

    expect(unlinkTicketArtifactForMcp).toHaveBeenCalledWith(auth, '0195c1e0-0000-7000-8000-000000000001')
  })
})
