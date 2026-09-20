/**
 * コマンド定義ファイルの書き戻しの単体テスト
 *
 * 固定したいのは「壊さない」ことの証拠。
 * - 許可(`target.editable`)の判定はディスクの現物から採る
 * - 断ったときはファイルが 1 バイトも変わらない
 * - 画面が触るのは `commands` だけで、`target` のコメントと書式は残る
 * - 読み込み側が除外する内容は、そもそも書けない
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const { clearCommandCatalogCache, commandFileRevision, getCommandCatalog, listCommandDefFileNames } =
  await import('@/lib/command/command-catalog')
const { COMMAND_DEF_CONFLICT, COMMAND_DEF_INVALID, COMMAND_DEF_NOT_EDITABLE } = await import('@/lib/command/command')
const { CommandDefWriteError, editCommandFileCommands } = await import('@/lib/command/command-writer')

const command = (id: string, sortOrder = 0) => ({
  id,
  label: id,
  executable: `/opt/bin/${id}.sh`,
  args: [],
  inputs: [],
  timeoutSec: 900,
  requireConfirm: true,
  requireFreshSession: false,
  singleton: true,
  sortOrder,
})

/** コメントと空行を混ぜた定義ファイル。保存後もこの体裁が残ることを確かめる */
const yaml = (targetId: string, opts?: { editable?: boolean; commands?: string[] }) =>
  [
    `# ${targetId} の定義`,
    'version: 1',
    '',
    '# 接続先(画面からは編集しない)',
    'target:',
    `  id: ${targetId}`,
    `  label: ${targetId.toUpperCase()} # 表示名`,
    `  host: ${targetId}.internal`,
    '  user: deploy',
    '  identityFile: ops_ed25519',
    ...(opts?.editable ? ['  editable: true'] : []),
    '',
    'commands:',
    ...(opts?.commands ?? ['  - id: deploy-web', '    label: deploy-web', '    executable: /opt/bin/deploy.sh']),
    '',
  ].join('\n')

let dir: string
let defDir: string
const originalDefDir = process.env.COMMAND_DEF_DIR

const write = (fileName: string, text: string) => writeFileSync(join(defDir, fileName), text)
const read = (fileName: string) => readFileSync(join(defDir, fileName), 'utf-8')
const revisionOf = (fileName: string) => commandFileRevision(read(fileName))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devuntu-command-writer-'))
  defDir = join(dir, 'commands')
  mkdirSync(defDir)
  process.env.COMMAND_DEF_DIR = defDir
  clearCommandCatalogCache()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (originalDefDir === undefined) {
    delete process.env.COMMAND_DEF_DIR
  } else {
    process.env.COMMAND_DEF_DIR = originalDefDir
  }
  clearCommandCatalogCache()
})

/** 断られたことと、ファイルが変わっていないことをまとめて確かめる */
const expectRejected = async (fileName: string, promise: Promise<unknown>, errorType: string) => {
  const before = read(fileName)
  await expect(promise).rejects.toThrow(CommandDefWriteError)
  await promise.catch((error: unknown) => {
    expect((error as InstanceType<typeof CommandDefWriteError>).errorType).toBe(errorType)
  })
  expect(read(fileName)).toBe(before)
}

describe('編集の許可', () => {
  it('editable が true なら書ける', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))

    const result = await editCommandFileCommands({
      fileName: 'web01.yaml',
      targetId: 'web01',
      revision: revisionOf('web01.yaml'),
      apply: (current) => [...current.commands, command('reindex')],
    })

    expect(result.commands.map((entry) => entry.id)).toEqual(['deploy-web', 'reindex'])
    expect(read('web01.yaml')).toContain('reindex')
  })

  it('editable を書いていないファイルは書けない', async () => {
    write('web01.yaml', yaml('web01'))
    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: revisionOf('web01.yaml'),
        apply: () => [command('reindex')],
      }),
      COMMAND_DEF_NOT_EDITABLE,
    )
  })

  it('画面の言い分ではなくディスクの現物で判定する', async () => {
    // 画面が editable だった頃の revision を握っていても、今の現物が false なら書かせない
    write('web01.yaml', yaml('web01', { editable: true }))
    write('web01.yaml', yaml('web01'))

    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: revisionOf('web01.yaml'),
        apply: () => [command('reindex')],
      }),
      COMMAND_DEF_NOT_EDITABLE,
    )
  })

  it('ファイル名が指すターゲットが権限を確かめた相手と違えば書かない', async () => {
    // ファイル名の解決はロックの外で行われるので、その間に target.id が差し替わる余地がある。
    // 現物のIDで確かめないと、権限の無いターゲットのファイルを書いてしまう
    write('web01.yaml', yaml('db01', { editable: true }))

    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: revisionOf('web01.yaml'),
        apply: () => [command('reindex')],
      }),
      COMMAND_DEF_CONFLICT,
    )
  })

  it('定義ディレクトリの外は指せない', async () => {
    await expect(
      editCommandFileCommands({
        fileName: '../escape.yaml',
        targetId: 'web01',
        revision: 'x'.repeat(16),
        apply: () => [],
      }),
    ).rejects.toMatchObject({ errorType: COMMAND_DEF_INVALID })
  })
})

describe('同時編集', () => {
  it('読んでから書くまでに変わっていれば書かない', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))
    const stale = revisionOf('web01.yaml')

    // 別の誰かが先に書いた
    await editCommandFileCommands({
      fileName: 'web01.yaml',
      targetId: 'web01',
      revision: stale,
      apply: (current) => [...current.commands, command('reindex')],
    })

    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: stale,
        apply: (current) => [...current.commands, command('dump')],
      }),
      COMMAND_DEF_CONFLICT,
    )
  })

  it('保存すると revision が変わる', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))
    const before = revisionOf('web01.yaml')

    const result = await editCommandFileCommands({
      fileName: 'web01.yaml',
      targetId: 'web01',
      revision: before,
      apply: (current) => [...current.commands, command('reindex')],
    })

    expect(result.revision).not.toBe(before)
    expect(result.revision).toBe(revisionOf('web01.yaml'))
  })
})

describe('ファイルの保ち方', () => {
  it('target のコメント・行内コメント・空行を残す', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))

    await editCommandFileCommands({
      fileName: 'web01.yaml',
      targetId: 'web01',
      revision: revisionOf('web01.yaml'),
      apply: (current) => current.commands,
    })

    const text = read('web01.yaml')
    expect(text).toContain('# web01 の定義')
    expect(text).toContain('# 接続先(画面からは編集しない)')
    expect(text).toContain('label: WEB01 # 表示名')
    expect(text).toContain('editable: true')
  })

  it('target は apply の戻り値に関わらず変わらない', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))

    await editCommandFileCommands({
      fileName: 'web01.yaml',
      targetId: 'web01',
      revision: revisionOf('web01.yaml'),
      apply: () => [command('reindex')],
    })

    const catalog = getCommandCatalog({ force: true })
    expect(catalog.catalog.targets[0]).toMatchObject({ id: 'web01', host: 'web01.internal', user: 'deploy' })
    expect(catalog.catalog.commands.map((entry) => entry.id)).toEqual(['reindex'])
  })

  it('一時ファイルは走査の対象にならない名前で作る', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))
    // 書き込み中に他プロセスが拾わないことを、選別の規則そのもので確かめる
    expect(listCommandDefFileNames(['.web01.yaml.123.abc.tmp', 'web01.yaml'])).toEqual(['web01.yaml'])
  })
})

describe('検証', () => {
  it('現物が壊れていれば編集を断る', async () => {
    write('web01.yaml', 'version: 1\ntarget: [unclosed')
    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: revisionOf('web01.yaml'),
        apply: () => [command('reindex')],
      }),
      COMMAND_DEF_INVALID,
    )
  })

  it('スキーマを通らない内容は書かない', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))
    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: revisionOf('web01.yaml'),
        // 未定義の入力項目を参照する引数
        apply: () => [{ ...command('reindex'), args: ['{{env}}'] }],
      }),
      COMMAND_DEF_INVALID,
    )
  })

  it('他のファイルとコマンドIDがぶつかる追加は書かない', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))
    write('db01.yaml', yaml('db01', { commands: ['  - id: dump-db', '    label: dump-db', '    executable: /d.sh'] }))

    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: revisionOf('web01.yaml'),
        apply: (current) => [...current.commands, command('dump-db')],
      }),
      COMMAND_DEF_INVALID,
    )
  })

  it('1ファイルの上限を超える追加は書かない', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))
    await expectRejected(
      'web01.yaml',
      editCommandFileCommands({
        fileName: 'web01.yaml',
        targetId: 'web01',
        revision: revisionOf('web01.yaml'),
        apply: () => Array.from({ length: 101 }, (_, index) => command(`cmd-${index}`)),
      }),
      COMMAND_DEF_INVALID,
    )
  })

  it('ディレクトリ全体の上限を超える追加は書かない', async () => {
    const many = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => [
        `  - id: ${prefix}-${index}`,
        `    label: ${prefix}-${index}`,
        `    executable: /opt/bin/x.sh`,
      ]).flat()
    write('a-web01.yaml', yaml('web01', { editable: true, commands: many('web', 100) }))
    write('b-db01.yaml', yaml('db01', { commands: many('db', 100) }))

    await expectRejected(
      'a-web01.yaml',
      editCommandFileCommands({
        fileName: 'a-web01.yaml',
        targetId: 'web01',
        revision: revisionOf('a-web01.yaml'),
        apply: (current) => [...current.commands.slice(0, 99), command('extra-1'), command('extra-2')],
      }),
      COMMAND_DEF_INVALID,
    )
  })
})

describe('反映', () => {
  it('保存した内容を同じプロセスがすぐ読み直せる', async () => {
    write('web01.yaml', yaml('web01', { editable: true }))
    expect(getCommandCatalog({ force: true }).catalog.commands.map((entry) => entry.id)).toEqual(['deploy-web'])

    await editCommandFileCommands({
      fileName: 'web01.yaml',
      targetId: 'web01',
      revision: revisionOf('web01.yaml'),
      apply: (current) => [...current.commands, command('reindex')],
    })

    // stat の間引きを跨がなくても、書いた側のプロセスには即座に反映される
    expect(getCommandCatalog().catalog.commands.map((entry) => entry.id)).toEqual(['deploy-web', 'reindex'])
  })
})
