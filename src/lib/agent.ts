/**
 * AIエージェント用ユーザーの共通定義(クライアント / サーバー共用)
 *
 * トークンの生成・検証は prisma と `node:crypto` に依存するため `agent-token.ts` に分けてある。
 * ここはフォームのバリデーションや一覧表示からも読むので、純粋な値と関数だけを置くこと。
 */

/**
 * エージェントのメールアドレスに使うドメイン。
 *
 * `User.email` は better-auth の必須列であり、メンションの突き合わせキー(`resolveMentionUserIds`)
 * でもあるため、エージェントにもアドレスを持たせる必要がある。一方で実在アドレスを持たせると、
 * accountLinking により人間の Google / OIDC ログインがエージェントのユーザーへ吸い寄せられてしまう。
 * RFC 2606 の予約 TLD `.invalid` は名前解決されないので、その取り違えとメール誤送信の両方を防げる。
 */
export const AGENT_EMAIL_DOMAIN = 'agents.invalid'

/** 識別子。メールアドレスのローカル部になるので、記号は先頭末尾に置けないハイフンだけに絞る */
export const AGENT_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

export const agentEmail = (handle: string): string => `${handle}@${AGENT_EMAIL_DOMAIN}`

export const agentHandle = (email: string): string | null => {
  const suffix = `@${AGENT_EMAIL_DOMAIN}`
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : null
}

/** 識別子の重複。Server Action は非同期関数しか export できないため定数はここに置く */
export const DUPLICATED_AGENT_HANDLE = 'DUPLICATED_AGENT_HANDLE'

/** トークンの有効期限の選択肢。`none` は無期限、それ以外は発行日からの日数 */
export const AGENT_TOKEN_EXPIRES = ['none', '30', '90', '180', '365'] as const
export type AgentTokenExpires = (typeof AGENT_TOKEN_EXPIRES)[number]

/** 選択肢を実際の有効期限へ変換する。無期限は null */
export const agentTokenExpiresAt = (value: AgentTokenExpires, from: Date): Date | null =>
  value === 'none' ? null : new Date(from.getTime() + Number(value) * 24 * 60 * 60 * 1000)
