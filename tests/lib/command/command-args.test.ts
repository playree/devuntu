/**
 * 入力値の検証と引数組み立ての単体テスト
 *
 * SSH の exec はリモートのログインシェルに1本の文字列を渡す仕様なので、
 * 「選択肢の外の値を通さないこと」と「クォートが破れないこと」がこの機能の安全性の中核になる。
 */

import { COMMAND_SENTINEL_MARK, COMMAND_START_SENTINEL, type CommandDef } from '@/lib/command/command'
import {
  buildArgsPreview,
  buildCommandInputDefaults,
  buildCommandInputSchema,
  buildRemoteCommand,
  CommandArgsError,
  isSentinelLine,
  resolveCommandArgs,
  shellQuote,
} from '@/lib/command/command-args'
import { describe, expect, it } from 'vitest'

const def = (overrides: Partial<CommandDef> = {}): CommandDef => ({
  id: 'deploy-web',
  label: 'デプロイ',
  targetId: 'web01',
  executable: '/opt/bin/deploy.sh',
  args: [],
  inputs: [],
  timeoutSec: 900,
  requireConfirm: true,
  requireFreshSession: false,
  singleton: true,
  sortOrder: 0,
  ...overrides,
})

const selectDef = def({
  args: ['{{env}}'],
  inputs: [
    {
      type: 'select',
      key: 'env',
      label: '環境',
      required: true,
      options: [
        { value: 'staging', label: 'stg' },
        { value: 'production', label: 'prod' },
      ],
    },
  ],
})

describe('shellQuote', () => {
  it.each([
    ["it's", `'it'\\''s'`],
    ['$(whoami)', `'$(whoami)'`],
    ['`id`', "'`id`'"],
    ['; rm -rf /', `'; rm -rf /'`],
    ['a\nb', `'a\nb'`],
    ['', `''`],
  ])('シェルに意味を持つ文字を無害化する (%s)', (value, expected) => {
    expect(shellQuote(value)).toBe(expected)
  })

  it('引用符を閉じて任意のコマンドへ抜けられない', () => {
    // `'; id; '` のような値でクォートを抜けようとしても、単一引用符が必ずエスケープされる
    const quoted = shellQuote("'; id; '")
    expect(quoted.startsWith("'")).toBe(true)
    expect(quoted.endsWith("'")).toBe(true)
    // 素の `'` は残らず、すべて '\'' の形になっている
    expect(quoted.slice(1, -1).replaceAll(`'\\''`, '')).not.toContain("'")
  })
})

describe('buildRemoteCommand', () => {
  it('番兵を出してから exec する', () => {
    const command = buildRemoteCommand('/opt/bin/deploy.sh', ['production'])
    expect(command).toBe(
      `printf '${COMMAND_SENTINEL_MARK}${COMMAND_START_SENTINEL}\\n' >&2; exec '/opt/bin/deploy.sh' 'production'`,
    )
  })

  it('引数はすべてクォートされる', () => {
    const command = buildRemoteCommand('/bin/echo', ['; id', '$(id)'])
    expect(command).toContain(`'; id'`)
    expect(command).toContain(`'$(id)'`)
  })
})

describe('isSentinelLine', () => {
  it('番兵行を見分ける', () => {
    expect(isSentinelLine(`${COMMAND_SENTINEL_MARK}${COMMAND_START_SENTINEL}`)).toBe(true)
    expect(isSentinelLine('deploy started')).toBe(false)
    // 区切り文字が無ければリモートの通常出力として扱う
    expect(isSentinelLine(COMMAND_START_SENTINEL)).toBe(false)
  })
})

describe('resolveCommandArgs / select', () => {
  it('選択肢の値を展開する', () => {
    expect(resolveCommandArgs(selectDef, { env: 'production' })).toEqual(['production'])
  })

  it.each(['prod', '', 'production ', '$(id)', 'staging;id'])('選択肢の外の値は弾く (%s)', (value) => {
    expect(() => resolveCommandArgs(selectDef, { env: value })).toThrow(CommandArgsError)
  })

  it('必須なのに未指定なら弾く', () => {
    expect(() => resolveCommandArgs(selectDef, {})).toThrow(CommandArgsError)
  })

  it('型が違えば弾く', () => {
    expect(() => resolveCommandArgs(selectDef, { env: ['production'] })).toThrow(CommandArgsError)
    expect(() => resolveCommandArgs(selectDef, { env: true })).toThrow(CommandArgsError)
  })

  it('定義に無いキーが混ざっていれば弾く', () => {
    // 黙って捨てると、画面を通さない呼び出しで何が渡されたか分からなくなる
    expect(() => resolveCommandArgs(selectDef, { env: 'staging', extra: 'x' })).toThrow(CommandArgsError)
  })

  it('必須でなければ未指定を許し、引数は増えない', () => {
    const optional = def({
      args: ['--fixed', '{{env}}'],
      inputs: [
        {
          type: 'select',
          key: 'env',
          label: '環境',
          required: false,
          options: [{ value: 'staging', label: 'stg' }],
        },
      ],
    })
    expect(resolveCommandArgs(optional, { env: '' })).toEqual(['--fixed'])
  })
})

describe('resolveCommandArgs / multiselect', () => {
  const multiDef = def({
    args: ['{{targets}}'],
    inputs: [
      {
        type: 'multiselect',
        key: 'targets',
        label: '対象',
        defaultValues: [],
        minSelected: 1,
        maxSelected: 3,
        options: [
          { value: 'alpha', label: 'a' },
          { value: 'bravo', label: 'b' },
          { value: 'charlie', label: 'c' },
        ],
      },
    ],
  })

  it('選択順ではなく定義の options 順で並べる', () => {
    // 順序を入力側で操作できると、同じ選択でも引数の並びが変わってしまう
    expect(resolveCommandArgs(multiDef, { targets: ['charlie', 'alpha'] })).toEqual(['alpha', 'charlie'])
  })

  it('重複は取り除く', () => {
    expect(resolveCommandArgs(multiDef, { targets: ['alpha', 'alpha'] })).toEqual(['alpha'])
  })

  it('選択数が範囲外なら弾く', () => {
    expect(() => resolveCommandArgs(multiDef, { targets: [] })).toThrow(CommandArgsError)
  })

  it('選択肢の外の値が1つでもあれば弾く', () => {
    expect(() => resolveCommandArgs(multiDef, { targets: ['alpha', 'delta'] })).toThrow(CommandArgsError)
  })
})

describe('resolveCommandArgs / checkbox', () => {
  const checkboxDef = def({
    args: ['deploy', '{{verbose}}'],
    inputs: [
      {
        type: 'checkbox',
        key: 'verbose',
        label: '詳細',
        default: false,
        whenTrue: ['--verbose', '--color=always'],
        whenFalse: [],
      },
    ],
  })

  it('チェック時は whenTrue を展開する', () => {
    expect(resolveCommandArgs(checkboxDef, { verbose: true })).toEqual(['deploy', '--verbose', '--color=always'])
  })

  it('未チェック時は whenFalse を展開する', () => {
    expect(resolveCommandArgs(checkboxDef, { verbose: false })).toEqual(['deploy'])
  })

  it('真偽値以外は弾く', () => {
    expect(() => resolveCommandArgs(checkboxDef, { verbose: 'true' })).toThrow(CommandArgsError)
  })
})

describe('resolveCommandArgs / input', () => {
  const inputDef = def({
    args: ['--tag', '{{tag}}'],
    inputs: [{ type: 'input', key: 'tag', label: 'タグ', required: true, maxLength: 20 }],
  })

  it.each(['v1.2.3', 'feature/DEV-1', 'user@example.net', 'a=b,c'])('使える文字はそのまま渡す (%s)', (value) => {
    expect(resolveCommandArgs(inputDef, { tag: value })).toEqual(['--tag', value])
  })

  it.each([
    // 先頭の `-` は、受け取ったスクリプトからオプションに見えてしまう
    '-rf',
    '--force',
    '$(id)',
    'a b',
    'a;id',
    "a'b",
    'a\nb',
  ])('使えない値は弾く (%s)', (value) => {
    expect(() => resolveCommandArgs(inputDef, { tag: value })).toThrow(CommandArgsError)
  })

  it('maxLength を超えれば弾く', () => {
    expect(resolveCommandArgs(inputDef, { tag: 'a'.repeat(20) })).toEqual(['--tag', 'a'.repeat(20)])
    expect(() => resolveCommandArgs(inputDef, { tag: 'a'.repeat(21) })).toThrow(CommandArgsError)
  })

  it('必須なのに空なら弾く', () => {
    expect(() => resolveCommandArgs(inputDef, { tag: '' })).toThrow(CommandArgsError)
    expect(() => resolveCommandArgs(inputDef, {})).toThrow(CommandArgsError)
  })

  it('文字列以外は弾く', () => {
    expect(() => resolveCommandArgs(inputDef, { tag: true })).toThrow(CommandArgsError)
    expect(() => resolveCommandArgs(inputDef, { tag: ['v1'] })).toThrow(CommandArgsError)
  })

  it('必須でなければ空を許し、引数は増えない', () => {
    const optional = def({
      args: ['--tag', '{{tag}}'],
      inputs: [{ type: 'input', key: 'tag', label: 'タグ', required: false, maxLength: 10 }],
    })
    // プレースホルダごと消えるので、値の無い `--tag` だけが残ることはない
    expect(resolveCommandArgs(optional, { tag: '' })).toEqual(['--tag'])
  })
})

describe('buildCommandInputSchema', () => {
  it('選択肢の外の値を弾く', () => {
    const schema = buildCommandInputSchema(selectDef)
    expect(schema.safeParse({ env: 'production' }).success).toBe(true)
    expect(schema.safeParse({ env: 'prod' }).success).toBe(false)
  })

  it('定義に無いキーを弾く', () => {
    const schema = buildCommandInputSchema(selectDef)
    expect(schema.safeParse({ env: 'production', extra: 'x' }).success).toBe(false)
  })

  it('フリー入力は使える文字と長さで弾く', () => {
    const schema = buildCommandInputSchema(
      def({ inputs: [{ type: 'input', key: 'tag', label: 'タグ', required: true, maxLength: 5 }] }),
    )
    expect(schema.safeParse({ tag: 'v1.2' }).success).toBe(true)
    expect(schema.safeParse({ tag: '-rf' }).success).toBe(false)
    expect(schema.safeParse({ tag: 'a b' }).success).toBe(false)
    expect(schema.safeParse({ tag: 'abcdef' }).success).toBe(false)
    // 必須なので空も通さない
    expect(schema.safeParse({ tag: '' }).success).toBe(false)
  })
})

describe('buildCommandInputDefaults', () => {
  it('定義の既定値から初期値を作る', () => {
    const withDefaults = def({
      inputs: [
        {
          type: 'select',
          key: 'env',
          label: '環境',
          required: true,
          defaultValue: 'production',
          options: [
            { value: 'staging', label: 'stg' },
            { value: 'production', label: 'prod' },
          ],
        },
        {
          type: 'multiselect',
          key: 'targets',
          label: '対象',
          defaultValues: ['alpha'],
          minSelected: 0,
          maxSelected: 3,
          options: [{ value: 'alpha', label: 'a' }],
        },
        { type: 'checkbox', key: 'verbose', label: '詳細', default: true, whenTrue: [], whenFalse: [] },
        { type: 'input', key: 'tag', label: 'タグ', required: true, maxLength: 10, defaultValue: 'v1.0.0' },
      ],
    })
    expect(buildCommandInputDefaults(withDefaults)).toEqual({
      env: 'production',
      targets: ['alpha'],
      verbose: true,
      tag: 'v1.0.0',
    })
  })

  it('必須で既定値が無ければ先頭の選択肢を使う', () => {
    expect(buildCommandInputDefaults(selectDef)).toEqual({ env: 'staging' })
  })

  it('フリー入力に既定値が無ければ空にする', () => {
    const noDefault = def({ inputs: [{ type: 'input', key: 'tag', label: 'タグ', required: true, maxLength: 10 }] })
    expect(buildCommandInputDefaults(noDefault)).toEqual({ tag: '' })
  })
})

describe('buildArgsPreview', () => {
  it('実行内容を1行で表す', () => {
    expect(buildArgsPreview(selectDef, ['production'])).toBe('/opt/bin/deploy.sh production')
  })
})
