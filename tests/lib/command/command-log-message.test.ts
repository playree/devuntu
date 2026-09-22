/**
 * 実行ログのシステム行のエンコードの単体テスト
 *
 * 固定したいのは「この仕組みより前に保存された平文を壊さないこと」と
 * 「壊れた入力でも表示側を落とさないこと」の2点。
 */

import { sanitizeLogText } from '@/lib/command/command-log'
import { decodeSystemMessage, encodeSystemMessage } from '@/lib/command/command-log-message'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

describe('encodeSystemMessage / decodeSystemMessage', () => {
  it('キーだけの行を往復できる', () => {
    expect(decodeSystemMessage(encodeSystemMessage('command_sys_canceled'))).toEqual({ item: 'command_sys_canceled' })
  })

  it('差し込む値ごと往復できる', () => {
    expect(decodeSystemMessage(encodeSystemMessage('command_sys_timeout', { sec: 30 }))).toEqual({
      item: 'command_sys_timeout',
      values: { sec: 30 },
    })
  })

  it('値が null でも往復できる', () => {
    expect(decodeSystemMessage(encodeSystemMessage('command_sys_timeout', { sec: null }))).toEqual({
      item: 'command_sys_timeout',
      values: { sec: null },
    })
  })

  it('保存時の sanitize を通しても読み出せる', () => {
    // 目印に使う制御文字が落とされると、保存済みの行がすべて平文扱いに戻ってしまう
    const encoded = sanitizeLogText(encodeSystemMessage('command_sys_timeout', { sec: 30 }))
    expect(decodeSystemMessage(encoded)).toEqual({ item: 'command_sys_timeout', values: { sec: 30 } })
  })

  it('この仕組みより前に保存された平文は null を返す', () => {
    expect(decodeSystemMessage('中断されました。')).toBeNull()
  })

  it('コマンドの出力が同じ形をしていても解釈しない', () => {
    expect(decodeSystemMessage('{"item":"command_sys_canceled"}')).toBeNull()
  })

  it('目印はあるが壊れている行は null を返す', () => {
    expect(decodeSystemMessage('\u0001lc:{"item":')).toBeNull()
    expect(decodeSystemMessage('\u0001lc:null')).toBeNull()
    expect(decodeSystemMessage('\u0001lc:["command_sys_canceled"]')).toBeNull()
    expect(decodeSystemMessage('\u0001lc:{"values":{"sec":30}}')).toBeNull()
    expect(decodeSystemMessage('\u0001lc:{"item":"command_sys_timeout","values":"30"}')).toBeNull()
  })

  it('実在しないロケールキーは null を返す', () => {
    // 解決できないキーを t() に渡すと空文字列になり、元の行が消えてしまう
    expect(decodeSystemMessage('\u0001lc:{"item":"not_a_locale_key"}')).toBeNull()
    expect(decodeSystemMessage('\u0001lc:{"item":"toString"}')).toBeNull()
  })

  it('差し込めない値が混ざっている行は null を返す', () => {
    expect(decodeSystemMessage('\u0001lc:{"item":"command_sys_timeout","values":{"sec":{"a":1}}}')).toBeNull()
    expect(decodeSystemMessage('\u0001lc:{"item":"command_sys_timeout","values":{"sec":[1]}}')).toBeNull()
  })
})
