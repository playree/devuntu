/**
 * 編集中のコマンド定義(YAML)の検証の単体テスト
 *
 * 固定したいのは**指摘が YAML のどこを指すか**。オフセットの数値は書き方で動くので、
 * `text.slice(from, to)` が何になるかで確かめる。
 */

import { lintCommandDefYaml } from '@/lib/command/command-def-lint'
import { describe, expect, it } from 'vitest'

const HEAD = ['id: my-command', 'label: デプロイ', 'executable: /opt/bin/deploy.sh'].join('\n')

/** 指摘を「指している文字列」と対にして取り出す */
const lint = (text: string, context?: { allowFreeInput: boolean }) =>
  lintCommandDefYaml(text, context).map((issue) => ({
    slice: text.slice(issue.from, issue.to),
    severity: issue.severity,
    message: issue.message,
  }))

describe('指摘が出ない場合', () => {
  it('正しい定義では何も出ない', () => {
    expect(lint(`${HEAD}\n`)).toEqual([])
  })

  it('空文字と空白だけでは何も出ない', () => {
    expect(lint('')).toEqual([])
    expect(lint('   \n\n')).toEqual([])
  })

  it('コメントだけでは何も出ない', () => {
    expect(lint('# あとで書く\n')).toEqual([])
  })
})

describe('書いた内容が間違っている場合', () => {
  it('値そのものを指す', () => {
    const issues = lint('id: my command\nlabel: デプロイ\nexecutable: /opt/bin/deploy.sh\n')
    expect(issues).toHaveLength(1)
    expect(issues[0].slice).toBe('my command')
    expect(issues[0].severity).toBe('error')
    expect(issues[0].message).toContain('識別子は英数字で始まる')
  })

  it('入れ子の奥でも値そのものを指す', () => {
    const text = [
      HEAD,
      'inputs:',
      '  - type: select',
      '    key: env',
      '    label: 環境',
      '    options:',
      '      - value: "bad value"',
      '        label: だめ',
      '',
    ].join('\n')
    const issues = lint(text)
    expect(issues).toHaveLength(1)
    expect(issues[0].slice).toBe('"bad value"')
  })

  it('配列の要素を指す', () => {
    const text = [HEAD, 'args:', "  - '--env={{env}}'", ''].join('\n')
    const issues = lint(text)
    expect(issues).toHaveLength(1)
    expect(issues[0].slice).toBe("'--env={{env}}'")
    expect(issues[0].message).toContain('プレースホルダは要素全体でのみ使える')
  })
})

describe('書かれていない場合', () => {
  it('未記入の必須項目は警告にして、文言へ項目名を戻す', () => {
    const issues = lint('id: my-command\nexecutable: /opt/bin/deploy.sh\n')
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].message).toBe('必須の項目 label が書かれていない')
  })

  it('キーだけ書いた状態はキーを指す(幅が無いと印が描けない)', () => {
    const issues = lint(`${HEAD}\ntimeoutSec:\n`)
    expect(issues).toHaveLength(1)
    expect(issues[0].slice).toBe('timeoutSec:')
    expect(issues[0].severity).toBe('warning')
  })

  it('たどれない奥の項目は、たどれた所の1行だけを指す', () => {
    const text = [HEAD, 'inputs:', '  - key: env', '    label: 環境', ''].join('\n')
    const issues = lint(text)
    expect(issues).toHaveLength(1)
    expect(issues[0].slice).toBe('  - key: env')
    expect(issues[0].message).toContain('inputs.0.type')
  })
})

describe('未知のキー', () => {
  it('値ではなくキーの側を指し、廃止した項目は理由まで出す', () => {
    const issues = lint(`${HEAD}\ntargetId: web01\n`)
    expect(issues).toHaveLength(1)
    expect(issues[0].slice.startsWith('targetId')).toBe(true)
    expect(issues[0].message).toBe('ターゲットは定義ファイル単位で決まるため commands[].targetId は書けない')
  })

  it('複数あるときはキーごとに分けて指す', () => {
    const issues = lint(`${HEAD}\nfoo: 1\nbar: 2\n`)
    expect(issues.map((issue) => issue.slice.split(':')[0])).toEqual(['foo', 'bar'])
  })

  it('入れ子の中の未知キーも指せる', () => {
    const text = [HEAD, 'inputs:', '  - type: checkbox', '    key: dry', '    label: 空実行', '    foo: 1', ''].join(
      '\n',
    )
    const issues = lint(text)
    expect(issues).toHaveLength(1)
    expect(issues[0].slice.startsWith('foo')).toBe(true)
  })
})

describe('YAML として読めない場合', () => {
  it('構文エラーだけを返し、スキーマの指摘は混ぜない', () => {
    const issues = lint('id: my-command\n  label: デプロイ\nexecutable: /opt/bin/deploy.sh\n')
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((issue) => !issue.message.includes('必須の項目'))).toBe(true)
  })

  it('タブのインデントを拾う', () => {
    const issues = lint('id: my-command\ninputs:\n\t- key: env\n')
    expect(issues.some((issue) => issue.message.includes('Tabs are not allowed'))).toBe(true)
  })
})

/**
 * フリー入力の許可はターゲット側にあり、ここで検証するコマンド 1 件の YAML には現れない。
 * 画面が知っている許可を渡したときだけ指摘する。
 */
describe('フリー入力', () => {
  const text = [HEAD, 'inputs:', '  - type: input', '    key: tag', '    label: タグ', ''].join('\n')

  it('許可が無いターゲットでは type の位置を指す', () => {
    const issues = lint(text, { allowFreeInput: false })
    expect(issues).toHaveLength(1)
    expect(issues[0].slice).toBe('input')
    expect(issues[0].severity).toBe('error')
    expect(issues[0].message).toContain('allowFreeInput: true')
  })

  it('許可のあるターゲットでは出ない', () => {
    expect(lint(text, { allowFreeInput: true })).toEqual([])
  })

  it('文脈を渡さなければ判定しない', () => {
    expect(lint(text)).toEqual([])
  })
})

describe('範囲の整合', () => {
  it('どの指摘も文書の内側にあり、幅が 1 文字以上ある', () => {
    const text = `${HEAD}\ntimeoutSec:\nfoo: 1\n`
    for (const issue of lintCommandDefYaml(text)) {
      expect(issue.from).toBeGreaterThanOrEqual(0)
      expect(issue.to).toBeLessThanOrEqual(text.length)
      expect(issue.to).toBeGreaterThan(issue.from)
    }
  })
})
