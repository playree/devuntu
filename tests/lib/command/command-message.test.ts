/**
 * コマンド定義の検証メッセージのロケール解決の単体テスト
 *
 * 検証側はロケールキーと差し込む値だけを返し、表示側のロケールで文字列になることを固定する。
 */

import { type CommandDef } from '@/lib/command/command'
import { CommandArgsError, resolveCommandArgs } from '@/lib/command/command-args'
import { mergeCommandFiles } from '@/lib/command/command-catalog'
import { formatCommandIssues, scCommandDefInput } from '@/lib/command/command-def'
import { lintCommandDefYaml } from '@/lib/command/command-def-lint'
import { commandText, formatCommandMessage } from '@/lib/command/command-message'
import { describe, expect, it, vi } from 'vitest'
import { formatEn, formatJa } from '../../helpers/command-message'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const command = (overrides: Record<string, unknown>) => ({
  id: 'deploy-web',
  label: 'デプロイ',
  executable: '/opt/bin/deploy.sh',
  ...overrides,
})

const defIssuesOf = (input: unknown) => {
  const parsed = scCommandDefInput.safeParse(input)
  return parsed.success ? [] : formatCommandIssues(parsed.error)
}

describe('formatCommandMessage', () => {
  it('訳を持たない文言はそのまま出し、位置があれば前に付ける', () => {
    const t = () => 'unused'
    expect(formatCommandMessage(commandText('Tabs are not allowed'), t)).toBe('Tabs are not allowed')
    expect(formatCommandMessage({ ...commandText('boom'), path: 'inputs.0' }, t)).toBe('inputs.0: boom')
  })
})

describe('スキーマの指摘', () => {
  it('差し込む値ごとロケールで解決される', () => {
    const issues = defIssuesOf(command({ args: ['{{env}}'] }))
    expect(issues.map(formatJa)).toEqual(['args.0: 未定義の入力項目 env を参照している'])
    expect(issues.map(formatEn)).toEqual(['args.0: References undefined input env'])
  })

  it('書式の指摘も英語になる', () => {
    const issues = defIssuesOf(command({ id: 'my command' }))
    expect(issues.map(formatEn)[0]).toMatch(/^id: Identifiers must be/)
  })

  it('未知キーはキーごとに 1 件へ分ける', () => {
    const issues = defIssuesOf(command({ targetId: 'web01', foo: 1 }))
    expect(issues.map(formatEn)).toEqual([
      'commands[].targetId is not allowed because the target is determined per definition file',
      'foo is not an allowed field',
    ])
  })

  it('zod の既定文は訳さずに残す', () => {
    const issues = defIssuesOf(command({ label: '' }))
    expect(issues).toHaveLength(1)
    expect('text' in issues[0]).toBe(true)
  })
})

describe('エディタの指摘', () => {
  it('書かれていない項目を英語で伝える', () => {
    const [issue] = lintCommandDefYaml('id: my-command\nexecutable: /opt/bin/deploy.sh\n')
    expect(formatEn(issue.message)).toBe('Required field label is missing')
  })

  it('フリー入力の不許可を英語で伝える', () => {
    const text = [
      'id: my-command',
      'label: tag',
      'executable: /opt/bin/deploy.sh',
      'inputs:',
      '  - type: input',
      '    key: tag',
      '    label: tag',
    ].join('\n')
    const [issue] = lintCommandDefYaml(text, { allowFreeInput: false })
    expect(formatEn(issue.message)).toContain('allowFreeInput: true')
  })
})

describe('ファイル横断の指摘', () => {
  it('ID の重複を英語で伝える', () => {
    const file = scCommandDefInput.parse(command({}))
    const target = { id: 'web01', label: 'WEB01', host: 'web01', user: 'deploy', identityFile: 'id_ed25519' }
    const entry = (fileName: string) => ({
      fileName,
      revision: '',
      file: {
        version: 1 as const,
        target: { ...target, kind: 'ssh' as const, port: 22, editable: false, allowFreeInput: false },
        commands: [file],
      },
    })
    const { issues } = mergeCommandFiles([entry('a.yaml'), entry('b.yaml')])
    expect(issues[0].messages.map(formatEn)).toEqual([
      'Target ID web01 is duplicated in b.yaml',
      'Command ID deploy-web is duplicated in b.yaml',
    ])
  })
})

describe('引数の組み立ての失敗', () => {
  it('理由をロケールキーで持つ', () => {
    const def: CommandDef = {
      ...scCommandDefInput.parse(command({})),
      targetId: 'web01',
    }
    let caught: unknown
    try {
      resolveCommandArgs(def, { env: 'staging' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CommandArgsError)
    const detail = (caught as CommandArgsError).detail
    expect(formatJa(detail)).toBe('未定義の入力項目 env が指定された')
    expect(formatEn(detail)).toBe('Undefined input env was given')
  })
})
