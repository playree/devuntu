/**
 * 自動運用の MCP ツール。
 *
 * mcp-server.test.ts と同じく InMemoryTransport でツールの入出力だけを見る。
 * 稼働条件やチケットの状態遷移そのものは agent-runner.test.ts の担当なので、ここでは
 * 「エージェント接続でしか登録されないこと」と「稼働条件・対象外チケットの扱い」を確かめる。
 */

import {
  activeWindowLabel,
  evaluateRunner,
  findAgentRunner,
  findAgentTicket,
  finishAgentTask,
  pickAgentTasks,
  resolveAgentTask,
} from '@/lib/agent/agent-runner'
import { assertTicketAccess } from '@/lib/board/board'
import { createDevuntuMcpServer } from '@/lib/mcp/mcp-server'
import { resolveTicketId } from '@/lib/mcp/mcp-ticket'
import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent/agent-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent/agent-runner')>()),
  findAgentRunner: vi.fn(),
  evaluateRunner: vi.fn(),
  pickAgentTasks: vi.fn(),
  activeWindowLabel: vi.fn(),
  findAgentTicket: vi.fn(),
  finishAgentTask: vi.fn(),
  resolveAgentTask: vi.fn(),
}))

vi.mock('@/lib/board/board', () => ({ assertTicketAccess: vi.fn() }))

vi.mock('@/lib/mcp/mcp-ticket', () => ({
  MCP_ASSIGNEE_ME: 'me',
  resolveTicketId: vi.fn(),
  getTicketForMcp: vi.fn(),
  searchTicketsForMcp: vi.fn(),
  createTicketForMcp: vi.fn(),
  updateTicketForMcp: vi.fn(),
  deleteTicketForMcp: vi.fn(),
  addTicketCommentForMcp: vi.fn(),
  updateTicketCommentForMcp: vi.fn(),
  deleteTicketCommentForMcp: vi.fn(),
}))

const agentAuth: ResourceAuth = {
  user: { id: 'a1', name: 'agent', email: 'agent@agents.invalid', role: null },
  scopes: ['mcp'],
  kind: 'agent',
  clientId: 'token-1',
}

const humanAuth: ResourceAuth = { ...agentAuth, kind: 'oauth', clientId: 'client-1' }

const runnerRow = { id: 'r1', userId: 'a1', rule: 'ルール' }

const connectClient = async (auth: ResourceAuth) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await createDevuntuMcpServer(auth).connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return client
}

/** ツールの返り値はJSONテキスト1件なので、そのままオブジェクトへ戻す */
const parseResult = (content: unknown) => JSON.parse((content as { text: string }[])[0].text)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findAgentRunner).mockResolvedValue(runnerRow as never)
  vi.mocked(evaluateRunner).mockReturnValue({ active: true, reason: null })
  vi.mocked(activeWindowLabel).mockReturnValue(null)
  vi.mocked(pickAgentTasks).mockResolvedValue([])
})

describe('自動運用ツールの登録', () => {
  const AGENT_TOOLS = ['get_agent_task', 'finish_agent_task']

  it('エージェント用トークンの接続では登録される', async () => {
    const { tools } = await (await connectClient(agentAuth)).listTools()
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(AGENT_TOOLS))
  })

  it('人間の OAuth 接続では登録されない', async () => {
    const { tools } = await (await connectClient(humanAuth)).listTools()
    const names = tools.map((tool) => tool.name)
    AGENT_TOOLS.forEach((name) => expect(names).not.toContain(name))
  })
})

describe('get_agent_setup_guide', () => {
  it('人間の OAuth 接続でも使える(ランナーを仕込むのは人の作業)', async () => {
    const { tools } = await (await connectClient(humanAuth)).listTools()
    expect(tools.map((tool) => tool.name)).toContain('get_agent_setup_guide')
  })

  it('このサーバーのランナー配布先と MCP のURLを埋めて返す', async () => {
    const result = await (await connectClient(agentAuth)).callTool({ name: 'get_agent_setup_guide', arguments: {} })
    const text = (result.content as { text: string }[])[0].text

    expect(text).toContain('http://localhost:3000/agent/devuntu_agent.py')
    expect(text).toContain('http://localhost:3000/api/mcp')
  })
})

describe('get_agent_task', () => {
  it('稼働条件を満たさない場合は作業を返さず、処理しないよう指示する', async () => {
    vi.mocked(evaluateRunner).mockReturnValue({ active: false, reason: 'outside_hours' })

    const result = await (await connectClient(agentAuth)).callTool({ name: 'get_agent_task', arguments: {} })
    const body = parseResult(result.content)

    expect(body).toMatchObject({ active: false, reason: 'outside_hours', task: null, tasks: [] })
    expect(body.note).toContain('処理は行わずに終了')
    expect(pickAgentTasks).not.toHaveBeenCalled()
  })

  it('チケット未指定なら処理待ちの一覧とルールを返す', async () => {
    const task = { ticketId: 't1', displayId: 'ABC-42', title: 'テスト', mode: 'plan', action: 'plan', state: null }
    vi.mocked(pickAgentTasks).mockResolvedValue([task] as never)

    const result = await (await connectClient(agentAuth)).callTool({ name: 'get_agent_task', arguments: {} })

    expect(parseResult(result.content)).toMatchObject({ active: true, rule: 'ルール', tasks: [task] })
  })

  it('チケット指定なら待ち行列ではなくそのチケットを解決する(処理中でも見失わない)', async () => {
    const task = {
      ticketId: 't1',
      displayId: 'ABC-42',
      title: 'テスト',
      mode: 'plan',
      action: 'plan',
      state: 'running',
    }
    vi.mocked(resolveAgentTask).mockResolvedValue(task as never)
    vi.mocked(resolveTicketId).mockResolvedValue('t1')

    const result = await (
      await connectClient(agentAuth)
    ).callTool({ name: 'get_agent_task', arguments: { ticketId: 'ABC-42' } })

    expect(resolveAgentTask).toHaveBeenCalledWith(runnerRow, 't1')
    expect(pickAgentTasks).not.toHaveBeenCalled()
    expect(parseResult(result.content)).toMatchObject({ task, note: null })
  })

  it('処理対象でないチケットを指定した場合は task が null になる', async () => {
    vi.mocked(resolveAgentTask).mockResolvedValue(null)
    vi.mocked(resolveTicketId).mockResolvedValue('t9')

    const result = await (
      await connectClient(agentAuth)
    ).callTool({ name: 'get_agent_task', arguments: { ticketId: 'ABC-99' } })
    const body = parseResult(result.content)

    expect(body.task).toBeNull()
    expect(body.note).toContain('処理対象ではない')
  })
})

describe('finish_agent_task', () => {
  it('チケットの参照権限と担当を確かめてから結果を記録する', async () => {
    vi.mocked(resolveTicketId).mockResolvedValue('t1')
    vi.mocked(findAgentTicket).mockResolvedValue({ id: 't1', displayId: 'ABC-42', mode: 'plan', state: 'running' })
    vi.mocked(finishAgentTask).mockResolvedValue({ state: 'planned' })

    const result = await (
      await connectClient(agentAuth)
    ).callTool({ name: 'finish_agent_task', arguments: { ticketId: 'ABC-42', outcome: 'planned', summary: '要約' } })

    expect(assertTicketAccess).toHaveBeenCalledWith(agentAuth.user, 't1', 'edit')
    expect(finishAgentTask).toHaveBeenCalledWith(runnerRow, 't1', 'planned', '要約')
    expect(parseResult(result.content)).toEqual({ displayId: 'ABC-42', outcome: 'planned', state: 'planned' })
  })

  it('担当・オプトインから外れたチケットは報告できない', async () => {
    vi.mocked(resolveTicketId).mockResolvedValue('t1')
    vi.mocked(findAgentTicket).mockResolvedValue(null)

    const result = await (
      await connectClient(agentAuth)
    ).callTool({ name: 'finish_agent_task', arguments: { ticketId: 'ABC-42', outcome: 'completed' } })

    expect(result.isError).toBe(true)
    expect(finishAgentTask).not.toHaveBeenCalled()
  })

  it('未知の結果は受け付けない', async () => {
    const result = await (
      await connectClient(agentAuth)
    ).callTool({ name: 'finish_agent_task', arguments: { ticketId: 'ABC-42', outcome: 'unknown' } })

    expect(result.isError).toBe(true)
    expect(finishAgentTask).not.toHaveBeenCalled()
  })
})
