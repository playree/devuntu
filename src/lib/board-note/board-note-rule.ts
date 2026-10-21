/**
 * ボードノート(メモリ / ナレッジ)の定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `board-note.ts` を参照。
 * 件数・版数の上限は環境変数から読むため、ここでは持たず引数で受け取る。
 */

import type { BoardNoteKind, BoardNoteType } from '@/generated/prisma/enums'

/** 区分。画面のタブの並び順を兼ねる */
export const BOARD_NOTE_KINDS = ['knowledge', 'memory'] as const satisfies readonly BoardNoteKind[]

/** 種別。宣言順が画面の並び順 */
export const BOARD_NOTE_TYPES = [
  'convention',
  'decision',
  'insight',
  'reference',
] as const satisfies readonly BoardNoteType[]

/** 種別を指定せずに作ったときの既定値 */
export const DEFAULT_BOARD_NOTE_TYPE: BoardNoteType = 'insight'

/** 名前は kebab-case(MCP で引くキーなので、表記ゆれで重複を作らせない) */
export const BOARD_NOTE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAX_BOARD_NOTE_NAME = 60
export const MAX_BOARD_NOTE_DESCRIPTION = 150

/** 本文の最大長。メモリは1件1事実なので短く、ナレッジは手順書なども入るので長めにとる */
export const MAX_BOARD_NOTE_CONTENT: Record<BoardNoteKind, number> = { knowledge: 20000, memory: 4000 }

/** MCP の応答に載せるメモリの索引の件数。ナレッジは人が管理する前提なので全件載せる */
export const MCP_MEMORY_INDEX_LIMIT = 50

/** MCP の get_board_notes で一度に本文を読める件数 */
export const MAX_BOARD_NOTE_NAMES_PER_READ = 10

/** 同じボード内での名前の重複(DB の @@unique([boardId, name]) 違反) */
export const DUPLICATED_BOARD_NOTE_NAME = 'DUPLICATED_BOARD_NOTE_NAME'
/** 区分ごとの件数の上限に達した */
export const BOARD_NOTE_LIMIT_REACHED = 'BOARD_NOTE_LIMIT_REACHED'
/** 読んだ後に他の人が更新した(expectedUpdatedAt の不一致) */
export const BOARD_NOTE_CONFLICT = 'BOARD_NOTE_CONFLICT'
/** ナレッジの変更に必要な同意が無い(MCP のみ) */
export const BOARD_NOTE_KNOWLEDGE_DENIED = 'BOARD_NOTE_KNOWLEDGE_DENIED'

/**
 * 書き込みの経路。ナレッジを変えてよいかの判定に使う。
 * - web: 画面(本人の操作なのでナレッジも可)
 * - mcp: agent はエージェント用トークン(ユーザー不在)、userApproved は AI が申告したユーザーの同意
 */
export type BoardNoteWriter = { via: 'web' } | { via: 'mcp'; agent: boolean; userApproved: boolean }

/** ナレッジを変えられない理由。変えられるなら null */
export const knowledgeDenial = (writer: BoardNoteWriter): 'agent' | 'approval' | null => {
  if (writer.via === 'web') {
    return null
  }
  if (writer.agent) {
    return 'agent'
  }
  return writer.userApproved ? null : 'approval'
}

/** ノートの変更がナレッジに関わるか(ナレッジの更新・削除、メモリからの昇格、ナレッジからの降格) */
export const touchesKnowledge = (before: BoardNoteKind | null, after: BoardNoteKind | null): boolean =>
  before === 'knowledge' || after === 'knowledge'

/** 版として残す項目 */
export type BoardNoteSnapshot = {
  kind: BoardNoteKind
  type: BoardNoteType
  name: string
  description: string
  content: string
}

export const sameBoardNoteSnapshot = (a: BoardNoteSnapshot, b: BoardNoteSnapshot): boolean =>
  a.kind === b.kind &&
  a.type === b.type &&
  a.name === b.name &&
  a.description === b.description &&
  a.content === b.content

/** 索引の1行。MEMORY.md と同じ粒度で、JSON のキーを繰り返さずに済む文字列にする */
export const boardNoteIndexLine = ({ name, description }: { name: string; description: string }): string =>
  `${name}: ${description}`

export type BoardNoteIndex = {
  boardKnowledge?: string[]
  boardMemory?: string[]
  /** 索引に載せきれなかったメモリの件数 */
  boardMemoryOmitted?: number
}

/**
 * MCP の応答に載せる索引。0 件の区分は項目ごと省く。
 * `knowledge` は名前順、`memory` は更新の新しい順で渡すこと(上限で切るのは古いメモリから)
 */
export const buildBoardNoteIndex = (
  knowledge: { name: string; description: string }[],
  memory: { name: string; description: string }[],
  memoryTotal: number,
): BoardNoteIndex => {
  const shown = memory.slice(0, MCP_MEMORY_INDEX_LIMIT)
  const omitted = memoryTotal - shown.length
  return {
    ...(knowledge.length > 0 ? { boardKnowledge: knowledge.map(boardNoteIndexLine) } : {}),
    ...(shown.length > 0 ? { boardMemory: shown.map(boardNoteIndexLine) } : {}),
    ...(omitted > 0 ? { boardMemoryOmitted: omitted } : {}),
  }
}
