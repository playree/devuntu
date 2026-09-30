/**
 * チケットの変更履歴の判定と表示ラベル(クライアント / サーバー共用)
 *
 * 変更前後の値を比べて記録する行を組み立てる純関数だけを置く。DB への書き込みは `ticket-activity.ts`。
 */

import type { TicketActivityField, TicketPriority } from '@/generated/prisma/enums'
import type { LocaleItemBase } from '@/locale'

/** 詳細画面に出す件数 */
export const TICKET_ACTIVITY_LIMIT = 100

/** MCP の get_ticket で返す件数 */
export const TICKET_ACTIVITY_MCP_LIMIT = 20

/** 本文の抜粋の文字数 */
export const ACTIVITY_CONTENT_EXCERPT = 100

/** 1つの値に持つ文字数の上限。受け入れ条件を一度に大量に書き換えても行が膨らまないようにする */
export const ACTIVITY_VALUE_MAX = 2000

export const TICKET_ACTIVITY_FIELD_LOCALE = {
  created: 'activity_created',
  title: 'title',
  content: 'content',
  status: 'status',
  priority: 'priority',
  dueDate: 'due_date',
  assignee: 'assignee',
  tags: 'tags',
  criteria: 'acceptance_criteria',
} as const satisfies Record<TicketActivityField, LocaleItemBase>

/** 記録する1行ぶん(変更者・日時は書き込み側で付ける) */
export type TicketActivityEntry = {
  field: TicketActivityField
  before: string | null
  after: string | null
}

/** `updateTicket` で比べる項目。タグは名前、期限は YYYY-MM-DD で持つ。担当は同名の相手がいても区別できるよう ID で比べ、名前を残す */
export type TicketActivitySnapshot = {
  title: string
  content: string | null
  priority: TicketPriority
  dueDate: string | null
  assignee: { id: string | null; name: string | null }
  tagNames: string[]
}

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max)}…` : value)

/** 本文の抜粋。改行・連続する空白は1つにまとめる */
export const excerptContent = (content: string | null): string | null => {
  const text = content?.replace(/\s+/g, ' ').trim()
  return text ? clip(text, ACTIVITY_CONTENT_EXCERPT) : null
}

const joinLines = (lines: string[]): string | null =>
  lines.length > 0 ? clip(lines.join('\n'), ACTIVITY_VALUE_MAX) : null

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/**
 * 変更前と変更後(undefined = 変更しない)を比べ、値が変わった項目だけを返す。
 * 本文は全文で比べ、記録には抜粋を残す
 */
export const diffTicketSnapshot = (
  before: TicketActivitySnapshot,
  after: Partial<TicketActivitySnapshot>,
): TicketActivityEntry[] => {
  const entries: TicketActivityEntry[] = []
  const scalar = (field: TicketActivityField, from: string | null, to: string | null | undefined) => {
    if (to !== undefined && (to || null) !== (from || null)) {
      entries.push({ field, before: from || null, after: to || null })
    }
  }

  scalar('title', before.title, after.title)
  if (after.content !== undefined && (after.content || null) !== (before.content || null)) {
    entries.push({ field: 'content', before: excerptContent(before.content), after: excerptContent(after.content) })
  }
  scalar('priority', before.priority, after.priority)
  scalar('dueDate', before.dueDate, after.dueDate)
  if (after.assignee && after.assignee.id !== before.assignee.id) {
    entries.push({ field: 'assignee', before: before.assignee.name || null, after: after.assignee.name || null })
  }
  if (after.tagNames && !sameSet(before.tagNames, after.tagNames)) {
    entries.push({
      field: 'tags',
      before: before.tagNames.join(', ') || null,
      after: after.tagNames.join(', ') || null,
    })
  }
  return entries
}

/** 受け入れ条件の変更。文言を変えた項目は「消して足した」として両方に載せる。並べ替えだけなら記録しない */
export const criteriaActivity = ({
  removed,
  added,
}: {
  removed: string[]
  added: string[]
}): TicketActivityEntry | null =>
  removed.length === 0 && added.length === 0
    ? null
    : { field: 'criteria', before: joinLines(removed), after: joinLines(added) }
