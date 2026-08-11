/** サーバー / クライアント双方の `t()` が共有する実装なので、置換規則をここで固定する */

import { expandTemplate } from '@/lib/locale-util'
import { describe, expect, it } from 'vitest'

describe('expandTemplate', () => {
  it('values を渡さなければテンプレートをそのまま返す', () => {
    expect(expandTemplate('${target} を削除しました。')).toBe('${target} を削除しました。')
  })

  it('プレースホルダを値で置換する', () => {
    expect(expandTemplate('${target} を削除しました。', { target: 'タグ' })).toBe('タグ を削除しました。')
  })

  it('同じキーが複数あればすべて置換する', () => {
    expect(expandTemplate('${a}-${a}', { a: 1 })).toBe('1-1')
  })

  it('数値も文字列化して埋める', () => {
    expect(expandTemplate('最大${max}件', { max: 100 })).toBe('最大100件')
  })

  it('null / undefined は空文字にする', () => {
    expect(expandTemplate('[${a}][${b}]', { a: null, b: undefined })).toBe('[][]')
  })

  it('values に無いキーはそのまま残す', () => {
    expect(expandTemplate('${target} を削除しました。', { other: 'x' })).toBe('${target} を削除しました。')
  })

  it('継承プロパティのキーは置換しない', () => {
    expect(expandTemplate('${toString}', {})).toBe('${toString}')
    expect(expandTemplate('${constructor}', {})).toBe('${constructor}')
  })

  it('JS の式としては評価しない', () => {
    expect(expandTemplate('${1 + 1}', { a: 1 })).toBe('${1 + 1}')
    expect(expandTemplate('${process.env.DATABASE_URL}', {})).toBe('${process.env.DATABASE_URL}')
  })
})
