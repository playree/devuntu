/**
 * HTTP / OAuth を経由せず、SDK の InMemoryTransport で MCP サーバーとクライアントを繋ぐ
 */

import type { ResourceAuth } from '@/lib/oauth/oauth-resource'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { oauthAuth } from './resource-auth'

/** 任意の McpServer に繋ぐ。ツール群を単体で登録したサーバーの検証に使う */
export const connectMcpServer = async (server: McpServer): Promise<Client> => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)
  return client
}

/**
 * `/api/mcp` と同じ構成のサーバーに、指定した認可情報で繋ぐ。
 * ツール群を単体で試すテストが mcp-server の依存まで読み込まないよう、使うときに import する
 */
export const connectDevuntuMcp = async (auth: ResourceAuth = oauthAuth()): Promise<Client> => {
  const { createDevuntuMcpServer } = await import('@/lib/mcp/mcp-server')
  return connectMcpServer(createDevuntuMcpServer(auth))
}

/** ツールの返り値のうち text ブロックを JSON として読む */
export const jsonOf = (result: unknown) => {
  const content = (result as { content: { type: string; text?: string }[] }).content
  return JSON.parse(content.find((block) => block.type === 'text')?.text ?? '{}')
}
