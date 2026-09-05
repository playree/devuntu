/**
 * MCP クライアントへ貼り付けるための登録コマンド(クライアント / サーバー共用)
 *
 * 発行画面がそのまま表示するだけなので、prisma や `node:crypto` を持ち込まないこと。
 */

/** `serverName` は登録先のローカル別名。相対解決で baseUrl のパス末尾を落とさないよう / を補う */
export const mcpAddCommand = (baseUrl: string, token: string, serverName: string): string =>
  `claude mcp add --transport http ${serverName} ${new URL('api/mcp', `${baseUrl.replace(/\/+$/, '')}/`).toString()} --header "Authorization: Bearer ${token}"`
