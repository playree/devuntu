/**
 * コマンド定義ファイルのスキーマの単体テスト
 *
 * ここで固定したいのは「定義の段階で、選択肢の外の値が引数へ入る余地を潰せていること」。
 * 定義ロード時のチェックが緩むと、実行時の検証だけが最後の砦になってしまう。
 */

import { formatCommandIssues, scCommandFile } from '@/lib/command/command-def'
import { describe, expect, it } from 'vitest'

const target = {
  id: 'web01',
  label: 'Web',
  host: 'web01.internal',
  user: 'deploy',
  identityFile: 'ops_ed25519',
}

const file = (overrides: Record<string, unknown>) => ({
  version: 1,
  target,
  commands: [
    {
      id: 'deploy-web',
      label: 'デプロイ',
      executable: '/opt/bin/deploy.sh',
      ...overrides,
    },
  ],
})

const issuesOf = (input: unknown): string[] => {
  const parsed = scCommandFile.safeParse(input)
  return parsed.success ? [] : formatCommandIssues(parsed.error)
}

describe('既定値の補完', () => {
  it('省略された項目に既定が入る', () => {
    const parsed = scCommandFile.parse(file({}))
    const command = parsed.commands[0]
    expect(command.timeoutSec).toBe(900)
    expect(command.singleton).toBe(true)
    expect(command.requireConfirm).toBe(true)
    expect(command.requireFreshSession).toBe(false)
    expect(command.args).toEqual([])
    expect(command.inputs).toEqual([])
    expect(parsed.target.port).toBe(22)
    expect(parsed.target.kind).toBe('ssh')
  })

  it('version が違えば読み込まない', () => {
    expect(scCommandFile.safeParse({ ...file({}), version: 2 }).success).toBe(false)
  })
})

describe('鍵ファイル名', () => {
  it.each(['../id_rsa', '..', '.', 'sub/dir/key', '/etc/passwd', '.hidden'])(
    'ディレクトリを辿れる名前は弾く (%s)',
    (identityFile) => {
      const input = { version: 1, target: { ...target, identityFile }, commands: [] }
      expect(scCommandFile.safeParse(input).success).toBe(false)
    },
  )

  it('英数字始まりの単純なファイル名は通す', () => {
    const input = { version: 1, target: { ...target, identityFile: 'ops_ed25519' }, commands: [] }
    expect(scCommandFile.safeParse(input).success).toBe(true)
  })
})

describe('プレースホルダ', () => {
  const withInput = (args: string[]) =>
    file({
      args,
      inputs: [{ type: 'select', key: 'env', label: '環境', options: [{ value: 'staging', label: 'stg' }] }],
    })

  it('要素まるごとのプレースホルダは通す', () => {
    expect(issuesOf(withInput(['{{env}}']))).toEqual([])
  })

  it('部分埋め込みは弾く', () => {
    // 値との境界が曖昧になり、多値展開の意味も定義できないため許さない
    const issues = issuesOf(withInput(['--flag={{env}}']))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('プレースホルダは要素全体でのみ使える')
  })

  it('未定義の入力項目を参照していれば弾く', () => {
    const issues = issuesOf(withInput(['{{unknown}}']))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('未定義の入力項目 unknown')
  })

  it('checkbox の展開結果にもプレースホルダは書けない', () => {
    const input = file({
      inputs: [
        {
          type: 'checkbox',
          key: 'verbose',
          label: '詳細',
          whenTrue: ['{{env}}'],
        },
      ],
    })
    expect(issuesOf(input)[0]).toContain('未定義の入力項目 env')
  })
})

describe('引数の文字集合', () => {
  it.each(['; rm -rf /', '$(whoami)', '`id`', 'a b', 'a&b', 'a|b', 'a>b', "it's"])(
    'シェルに意味を持つ文字を含む固定引数は弾く (%s)',
    (token) => {
      expect(issuesOf(file({ args: [token] }))).not.toEqual([])
    },
  )

  it.each(['--verbose', 'production', 'v1.2.3', 'a/b/c', 'user@host', 'k=v', 'a,b'])(
    '通常の引数は通す (%s)',
    (token) => {
      expect(issuesOf(file({ args: [token] }))).toEqual([])
    },
  )

  it('選択肢の値にもシェル特殊文字は入れられない', () => {
    const input = file({
      inputs: [{ type: 'select', key: 'env', label: '環境', options: [{ value: '$(id)', label: 'x' }] }],
    })
    expect(scCommandFile.safeParse(input).success).toBe(false)
  })
})

describe('書けない項目', () => {
  it('commands[].targetId は弾き、理由を出す', () => {
    // ホストはファイル単位で決まる。書けてしまうと「どのホストで動くか」がファイルを見ても分からない
    const issues = issuesOf(file({ targetId: 'web01' }))
    expect(issues.some((issue) => issue.includes('commands[].targetId は書けない'))).toBe(true)
  })

  it('トップレベルの hosts 配列は弾き、理由を出す', () => {
    const issues = issuesOf({ ...file({}), hosts: [target] })
    expect(issues.some((issue) => issue.includes('1 ファイルに 1 実行先を target へ書く'))).toBe(true)
  })

  it('旧形式の host は弾き、target へ書くよう促す', () => {
    const { target: _target, ...rest } = file({})
    const issues = issuesOf({ ...rest, host: target })
    expect(issues.some((issue) => issue.includes('接続先は target へ書く'))).toBe(true)
  })

  it('target が無ければ弾く', () => {
    const { target: _target, ...rest } = file({})
    expect(scCommandFile.safeParse(rest).success).toBe(false)
  })

  it('綴りを間違えた項目は黙って捨てずに弾く', () => {
    // 既定値が効かないだけの状態で読み込めてしまうと、定義した本人が気付けない
    const input = file({
      inputs: [
        { type: 'select', key: 'env', label: '環境', options: [{ value: 'stg', label: 'stg' }], default: 'stg' },
      ],
    })
    expect(issuesOf(input).some((issue) => issue.includes('default'))).toBe(true)
  })
})

describe('参照の整合', () => {
  it('コマンドIDの重複を弾く', () => {
    const base = file({})
    const issues = issuesOf({ ...base, commands: [base.commands[0], base.commands[0]] })
    expect(issues.some((issue) => issue.includes('コマンドID deploy-web が重複'))).toBe(true)
  })

  it('入力項目のキーの重複を弾く', () => {
    const input = file({
      inputs: [
        { type: 'select', key: 'env', label: 'A', options: [{ value: 'a', label: 'a' }] },
        { type: 'radio', key: 'env', label: 'B', options: [{ value: 'b', label: 'b' }] },
      ],
    })
    expect(issuesOf(input).some((issue) => issue.includes('入力項目のキー env が重複'))).toBe(true)
  })

  it('既定値が選択肢に無ければ弾く', () => {
    const input = file({
      inputs: [
        { type: 'select', key: 'env', label: '環境', options: [{ value: 'stg', label: 'stg' }], defaultValue: 'prod' },
      ],
    })
    expect(issuesOf(input).some((issue) => issue.includes('既定値 prod が選択肢に無い'))).toBe(true)
  })

  it('multiselect の minSelected が maxSelected を超えていれば弾く', () => {
    const input = file({
      inputs: [
        {
          type: 'multiselect',
          key: 'targets',
          label: '対象',
          options: [{ value: 'a', label: 'a' }],
          minSelected: 3,
          maxSelected: 1,
        },
      ],
    })
    expect(issuesOf(input).some((issue) => issue.includes('minSelected'))).toBe(true)
  })

  it('multiselect の minSelected が選択肢の数を超えていれば弾く', () => {
    // 満たせる選択が無い定義。読み込めてしまうと実行できないコマンドが一覧に出る
    const input = file({
      inputs: [
        {
          type: 'multiselect',
          key: 'targets',
          label: '対象',
          options: [{ value: 'a', label: 'a' }],
          minSelected: 2,
          maxSelected: 3,
        },
      ],
    })
    expect(issuesOf(input).some((issue) => issue.includes('minSelected が選択肢の数を超えている'))).toBe(true)
  })
})
