/**
 * getFieldConstraints の単体テスト
 *
 * この関数は zod の内部表現(`_zod.def`)を直接読んで HTML の制約属性を組み立てているため、
 * zod のアップデートで内部の形が変わると型エラーにならないまま静かに壊れる。
 * 入力欄の maxLength / minLength / required が失われたことを検知するのが目的。
 */

import { scBusyTimeBase, zDescription, zName } from '@/lib/schema/schema'
import { getFieldConstraints } from '@/lib/schema/schema-util'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('getFieldConstraints', () => {
  it('文字列の min/max を minLength/maxLength として取り出す', () => {
    const sc = z.object({ name: zName })
    expect(getFieldConstraints(sc, 'name')).toEqual({ isRequired: true, minLength: 2, maxLength: 30 })
  })

  it('optional のラッパー越しでも制約を取り出し、必須ではないと判定する', () => {
    const sc = z.object({ description: zDescription })
    expect(getFieldConstraints(sc, 'description')).toEqual({ isRequired: false, maxLength: 40 })
  })

  it('数値の min/max を min/max として取り出す', () => {
    expect(getFieldConstraints(scBusyTimeBase, 'startMin')).toEqual({ isRequired: true, min: 0, max: 1410 })
  })

  it('配列の min は minLength になる', () => {
    expect(getFieldConstraints(scBusyTimeBase, 'weekdays')).toEqual({ isRequired: true, minLength: 1 })
  })

  it('default / prefault は必須ではないと判定する', () => {
    const sc = z.object({ withDefault: z.string().default('x'), withPrefault: z.string().prefault('y') })
    expect(getFieldConstraints(sc, 'withDefault')).toEqual({ isRequired: false })
    expect(getFieldConstraints(sc, 'withPrefault')).toEqual({ isRequired: false })
  })

  it('nullable 単体は undefined を許容しないので必須のままにする', () => {
    const sc = z.object({ nullable: z.string().nullable() })
    expect(getFieldConstraints(sc, 'nullable')).toEqual({ isRequired: true })
  })

  it('存在しないフィールドは空を返す', () => {
    expect(getFieldConstraints(z.object({ name: zName }), 'unknown')).toEqual({})
  })
})
