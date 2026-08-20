/** HTTP/OAuth を経由せず、SDK の InMemoryTransport で ping/echo ツールの入出力だけを検証する */

import { createDevuntuMcpServer } from '@/lib/mcp-server'
import type { ResourceAuth } from '@/lib/oauth-resource'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

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
  it('ping/echo が tools/list に現れる', async () => {
    const { tools } = await (await connectClient()).listTools()
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['ping', 'echo']))
  })

  it('ping は認可済みユーザーの情報を返す', async () => {
    const result = await (await connectClient()).callTool({ name: 'ping', arguments: {} })
    expect(result.content).toEqual([{ type: 'text', text: `pong: ${auth.user.email}` }])
  })

  it('echo は入力をそのまま返す', async () => {
    const result = await (await connectClient()).callTool({ name: 'echo', arguments: { message: 'hello' } })
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
  })
})
