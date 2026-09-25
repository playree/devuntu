/**
 * タグの定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `tag.ts` を参照。
 */

import type { TagColor } from '@/generated/prisma/enums'

/**
 * タグの表示色(定義順 = 選択UIの並び順)。Prisma の TagColor enum と一致させる。
 * HeroUI Chip は 5 色しか持たないため、実際の配色は tagColorClass で Tailwind へマップする。
 */
export const TAG_COLORS = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
] as const satisfies readonly TagColor[]

/** 1 チケットに付けられるタグ数 */
export const MAX_TICKET_TAGS = 10

/** タグ名の最大長 */
export const MAX_TAG_NAME = 20

/** 1 ボードあたりのタグ数上限(選択UIが破綻しない範囲) */
export const MAX_TAGS_PER_SCOPE = 50

/** 同じボード内でのタグ名の重複(DB の @@unique([boardId, name]) 違反) */
export const DUPLICATED_TAG_NAME = 'DUPLICATED_TAG_NAME'

/** 表記そのままで trim + 空除去 + 重複除去(検索条件を無駄に増やさない) */
export const dedupeTagNames = (names: string[]): string[] => [
  ...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0)),
]

/** 同名タグ(別ボード)を 1 件に畳む。色は最初に見つかったものを採用する */
export const dedupeTagOptionsByName = <T extends { name: string }>(tags: T[]): T[] => {
  const byName = new Map<string, T>()
  for (const tag of tags) {
    if (!byName.has(tag.name)) {
      byName.set(tag.name, tag)
    }
  }
  return [...byName.values()]
}

/** 既存 order の最大 + 1、空なら 0。タグの表示順とレーン内の並び順で共用する(詰め直しはしない) */
export const nextOrder = (existing: number[]): number => existing.reduce((max, v) => (v > max ? v : max), -1) + 1

/**
 * TicketTag の総入れ替えに必要な差分を求める(syncTicketTags の判断部分)。
 * 重複指定は畳み、変化しない tagId は触らないことで不要な DELETE/INSERT を避ける。
 */
export const diffTagIds = (current: string[], next: string[]): { toAdd: string[]; toRemove: string[] } => {
  const currentSet = new Set(current)
  const nextSet = new Set(next)
  return {
    toAdd: [...nextSet].filter((id) => !currentSet.has(id)),
    toRemove: [...currentSet].filter((id) => !nextSet.has(id)),
  }
}
