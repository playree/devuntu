/**
 * MCP の共通定義(クライアント / サーバー共用)
 *
 * トークンの生成・検証は prisma と `node:crypto` に依存するため `mcp-token.ts` に分けてある。
 * ここはトークンの発行画面からも読むので、純粋な値と関数だけを置くこと。
 */

/** エージェント用トークンや OAuth のアクセストークン(JWT)と取り違えないための接頭辞 */
export const MCP_TOKEN_PREFIX = 'devuntu_pat_'

/** 1ユーザーが持てる MCP トークンの本数。UI とサーバーの双方で歯止めに使う */
export const MAX_MCP_TOKENS_PER_USER = 10

/** MCP トークンの名前の重複。Server Action は非同期関数しか export できないため定数はここに置く */
export const DUPLICATED_MCP_TOKEN_NAME = 'DUPLICATED_MCP_TOKEN_NAME'

/** MCP トークンの本数が上限に達した。汎用のバリデーションエラーと区別して発行画面で理由を出す */
export const MCP_TOKEN_LIMIT_REACHED = 'MCP_TOKEN_LIMIT_REACHED'

/**
 * `claude mcp add` の登録先スコープ。
 * `local` は CLI の既定なのでフラグを出さない(エージェント向けの表示コマンドを変えないため)。
 */
export type McpAddScope = 'local' | 'user'

/** MCP クライアントへ貼り付けるための登録コマンド。`serverName` は登録先の別名 */
export const mcpAddCommand = (baseUrl: string, token: string, serverName: string, scope: McpAddScope): string => {
  // 相対解決で baseUrl のパス末尾を落とさないよう / を補う
  const url = new URL('api/mcp', `${baseUrl.replace(/\/+$/, '')}/`).toString()
  const scopeOption = scope === 'user' ? '--scope user ' : ''
  return `claude mcp add ${scopeOption}--transport http ${serverName} ${url} --header "Authorization: Bearer ${token}"`
}
