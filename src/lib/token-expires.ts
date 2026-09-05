/**
 * 長期トークンの有効期限(クライアント / サーバー共用)
 *
 * エージェント用トークンとユーザー用 MCP トークンで同じ選択肢を使う。
 * フォームのバリデーションからも読むので、純粋な値と関数だけを置くこと。
 */

/** トークンの有効期限の選択肢。`none` は無期限、それ以外は発行日からの日数 */
export const TOKEN_EXPIRES = ['none', '30', '90', '180', '365'] as const
export type TokenExpires = (typeof TOKEN_EXPIRES)[number]

/** 選択肢を実際の有効期限へ変換する。無期限は null */
export const tokenExpiresAt = (value: TokenExpires, from: Date): Date | null =>
  value === 'none' ? null : new Date(from.getTime() + Number(value) * 24 * 60 * 60 * 1000)

/** 1ユーザーが持てる MCP トークンの本数。UI とサーバーの双方で歯止めに使う */
export const MAX_MCP_TOKENS_PER_USER = 10

/** MCP トークンの名前の重複。Server Action は非同期関数しか export できないため定数はここに置く */
export const DUPLICATED_MCP_TOKEN_NAME = 'DUPLICATED_MCP_TOKEN_NAME'
