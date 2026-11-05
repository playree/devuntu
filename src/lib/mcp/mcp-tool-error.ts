import { ClientError } from '@/lib/error'
import { logger } from '@/lib/logger'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** 想定外の例外でクライアントへ返す文言。Server Action の `handleServerError` とそろえる */
export const MCP_INTERNAL_ERROR_MESSAGE = 'Internal Server Error'

/**
 * SDK はツールが投げた例外の `message` をそのままツールエラーとして返す。
 * ClientError は理由と対処を AI に伝えるための文言なのでそのまま通し、
 * それ以外(Prisma の制約名・接続先などが混ざりうる)はログにだけ残して固定文言に差し替える。
 */
const guardToolCallback =
  <A extends unknown[], R>(name: string, cb: (...args: A) => R | Promise<R>) =>
  async (...args: A): Promise<R> => {
    try {
      return await cb(...args)
    } catch (error) {
      if (error instanceof ClientError) {
        throw error
      }
      logger.error({ tool: name, err: error }, 'mcp tool failed')
      throw new Error(MCP_INTERNAL_ERROR_MESSAGE)
    }
  }

/**
 * 以降に `registerTool` で登録するツールすべてに例外の扱いを掛ける。
 * ツールはドメインごとのファイルから同じ server に登録されるので、生成直後に一度だけ呼ぶ
 */
export const guardMcpToolErrors = (server: McpServer): void => {
  const register = server.registerTool.bind(server)
  server.registerTool = ((name: string, config: unknown, cb: (...args: unknown[]) => unknown) =>
    register(name, config as never, guardToolCallback(name, cb) as never)) as McpServer['registerTool']
}
