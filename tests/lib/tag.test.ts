/**
 * タグ関連の純粋関数の単体テスト
 *
 * `src/lib/tag.ts` は prisma に依存するためテスト対象にしない。
 * 判断部分は `src/lib/task.ts` の純粋関数へ寄せてあるので、そちらを検証する
 * (`board.ts` に単体テストが無いのと同じ方針)。
 */

import { BoardKind, TagColor } from '@/generated/prisma/enums'
import { dedupeTagNames, dedupeTagOptionsByName, diffTagIds, TAG_COLORS } from '@/lib/board/task'
import { describe, expect, it } from 'vitest'

describe('TAG_COLORS / BoardKind: Prisma の enum と一致していること', () => {
  it('TAG_COLORS は TagColor enum と同じ値・同じ件数', () => {
    // 件数も比較することで、Prisma 側に色を追加して TAG_COLORS の更新を忘れた場合に落ちる
    const fromPrisma = Object.values(TagColor)
    expect(TAG_COLORS, '選択UIの並び順は TAG_COLORS の定義順が単一ソース').toEqual(fromPrisma)
  })

  it('BoardKind は private, team の順で宣言されている', () => {
    // PostgreSQL の enum は宣言順で比較されるため、/boards の
    // `orderBy: { kind: 'asc' }` でプライベートを先頭に出す前提が崩れると落ちる
    expect(Object.values(BoardKind)).toEqual(['private', 'team'])
  })
})

describe('dedupeTagNames: 検索条件のタグ名を整える', () => {
  it('trim して空文字を除く', () => {
    expect(dedupeTagNames([' bug ', '', '  ', 'ui'])).toEqual(['bug', 'ui'])
  })

  it('trim 後に同じになる名前は 1 件へ畳む', () => {
    expect(dedupeTagNames(['bug', ' bug', 'bug '])).toEqual(['bug'])
  })

  it('大文字小文字は別のタグとして扱う(表記はそのまま保持する)', () => {
    expect(dedupeTagNames(['Bug', 'bug'])).toEqual(['Bug', 'bug'])
  })

  it('順序は最初の出現順を保つ', () => {
    expect(dedupeTagNames(['ui', 'bug', 'ui'])).toEqual(['ui', 'bug'])
  })

  it('空配列は空配列', () => {
    expect(dedupeTagNames([])).toEqual([])
  })
})

describe('dedupeTagOptionsByName: 同名タグ(別ボード)を 1 チップへ畳む', () => {
  const tags = [
    { id: 't1', boardId: 'b1', name: 'bug', color: 'red' as TagColor },
    { id: 't2', boardId: 'b2', name: 'bug', color: 'blue' as TagColor },
    { id: 't3', boardId: 'b2', name: 'ui', color: 'green' as TagColor },
  ]

  it('同名は 1 件になり、色は最初に見つかったものを採用する', () => {
    const res = dedupeTagOptionsByName(tags)
    expect(res, 'bug と ui の 2 件').toHaveLength(2)
    expect(res[0], '先に現れた b1 の bug が残る').toEqual(tags[0])
  })

  it('同名が無ければそのまま返す', () => {
    expect(dedupeTagOptionsByName([tags[0], tags[2]])).toEqual([tags[0], tags[2]])
  })

  it('空配列は空配列', () => {
    expect(dedupeTagOptionsByName([])).toEqual([])
  })
})

describe('diffTagIds: TicketTag の差分を求める', () => {
  it('追加と削除を振り分ける', () => {
    expect(diffTagIds(['a', 'b'], ['b', 'c'])).toEqual({ toAdd: ['c'], toRemove: ['a'] })
  })

  it('変化が無ければ両方空(不要な DELETE / INSERT を出さない)', () => {
    expect(diffTagIds(['a', 'b'], ['b', 'a'])).toEqual({ toAdd: [], toRemove: [] })
  })

  it('全削除・全追加も扱える', () => {
    expect(diffTagIds(['a'], [])).toEqual({ toAdd: [], toRemove: ['a'] })
    expect(diffTagIds([], ['a'])).toEqual({ toAdd: ['a'], toRemove: [] })
  })

  it('重複指定は畳まれる', () => {
    expect(diffTagIds(['a', 'a'], ['a', 'b', 'b'])).toEqual({ toAdd: ['b'], toRemove: [] })
  })
})
