/**
 * MCP の共通定義(クライアント / サーバー共用)
 *
 * トークンの生成・検証は prisma と `node:crypto` に依存するため `mcp-token.ts` に分けてある。
 * ここはトークンの発行画面からも読むので、純粋な値と関数だけを置くこと。
 */

/** エージェント用トークンや OAuth のアクセストークン(JWT)と取り違えないための接頭辞 */
export const MCP_TOKEN_PREFIX = 'devuntu_pat_'

/**
 * MCP トークンを設定ファイルから参照するための環境変数名(エージェント用の `AGENT_TOKEN_ENV` と対)。
 * Codex は設定ファイルにトークンそのものを書けず、環境変数の名前しか持てないため必要になる。
 */
export const MCP_TOKEN_ENV = 'DEVUNTU_MCP_TOKEN'

/** 1ユーザーが持てる MCP トークンの本数。UI とサーバーの双方で歯止めに使う */
export const MAX_MCP_TOKENS_PER_USER = 10

/** MCP トークンの名前の重複。Server Action は非同期関数しか export できないため定数はここに置く */
export const DUPLICATED_MCP_TOKEN_NAME = 'DUPLICATED_MCP_TOKEN_NAME'

/** MCP トークンの本数が上限に達した。汎用のバリデーションエラーと区別して発行画面で理由を出す */
export const MCP_TOKEN_LIMIT_REACHED = 'MCP_TOKEN_LIMIT_REACHED'

/**
 * MCP サーバー名(`mcp-server.ts` が名乗る `serverInfo.name`)。
 * 登録コマンドの表示と実際の名乗りをずらさないため、双方からこれを読む。
 */
export const MCP_SERVER_NAME = 'devuntu'
export const AGENT_MCP_SERVER_NAME = 'devuntu-agent'

/** MCP のエンドポイント。相対解決で baseUrl のパス末尾を落とさないよう / を補う */
const mcpUrl = (baseUrl: string): string => new URL('api/mcp', `${baseUrl.replace(/\/+$/, '')}/`).toString()

/**
 * `claude mcp add` の登録先スコープ。
 * `local` は CLI の既定なのでフラグを出さない。
 */
export type McpAddScope = 'local' | 'user' | 'project'

/**
 * Claude Code へ貼り付けるための登録コマンド。`serverName` は登録先の別名。
 *
 * `token` には実トークンのほか環境変数参照(`${...}`)も渡すため、シェルに展開させないよう
 * ヘッダはシングルクォートで囲む。
 */
export const mcpAddCommand = (baseUrl: string, token: string, serverName: string, scope: McpAddScope): string => {
  const scopeOption = scope === 'local' ? '' : `--scope ${scope} `
  return `claude mcp add ${scopeOption}--transport http ${serverName} ${mcpUrl(baseUrl)} --header 'Authorization: Bearer ${token}'`
}

/**
 * Codex CLI へ貼り付けるための登録コマンド。トークンは `tokenEnv` の環境変数から読ませる。
 *
 * 書き込み先は `~/.codex/config.toml`(ユーザー設定)で、Claude Code の `--scope project` に当たる
 * 指定は持たない。作業ディレクトリごとに分けたい場合はセットアップ手順の方法で設定ファイルへ書く。
 */
export const mcpCodexAddCommand = (baseUrl: string, serverName: string, tokenEnv: string): string =>
  `codex mcp add --url ${mcpUrl(baseUrl)} --bearer-token-env-var ${tokenEnv} ${serverName}`

/**
 * Codex 用の環境変数をシェルへ設定するコマンド。
 *
 * Codex は接続のたびに環境変数を読むので、シェルの設定ファイルへ残す必要がある。
 * トークンは発行時にしか見せられないため、利用者が組み立てずに済むよう画面から丸ごと渡す。
 */
export const mcpTokenExportCommand = (tokenEnv: string, token: string): string => `export ${tokenEnv}='${token}'`
