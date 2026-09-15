/**
 * コマンド定義ディレクトリの読み込みの単体テスト
 *
 * 固定したいのは3点。
 * - 壊れたファイルは**そのファイルだけ**を捨て、残りのホストのコマンドは生かす
 * - ID がぶつかったファイルはどちらも採らない(履歴のキーと実際に走る中身が食い違わないように)
 * - ディレクトリの中身の変化にプロセスが自律的に追随する(リロードの伝播機構を持たなくてよい根拠)
 */

import { MAX_COMMAND_DEF_ENTRIES } from '@/lib/command/command'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// logger はテスト出力を汚すだけなので黙らせる
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

/**
 * `readdirSync` の並びはファイルシステム任せで、作成順とも名前順とも限らない。
 * 走査の上限をどの段階で掛けるかを確かめるには並びが決まっている必要があるので、名前順に固定する。
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    // 実装が呼ぶのは文字列を返すオーバーロードだけ
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) =>
      (actual.readdirSync(...args) as unknown as string[]).sort(),
  }
})

const {
  buildCommandTargetStatus,
  clearCommandCatalogCache,
  getCommandCatalog,
  listCommandDefFileNames,
  resolveSshFilePath,
} = await import('@/lib/command/command-catalog')

/** 実行先1件ぶんの定義ファイル。コマンドは `id: sortOrder` の組で与える */
const yaml = (targetId: string, commands: [string, number][]) =>
  [
    'version: 1',
    'target:',
    `  id: ${targetId}`,
    `  label: ${targetId.toUpperCase()}`,
    `  host: ${targetId}.internal`,
    '  user: deploy',
    '  identityFile: ops_ed25519',
    'commands:',
    ...commands.flatMap(([id, sortOrder]) => [
      `  - id: ${id}`,
      `    label: ${id}`,
      `    executable: /opt/bin/${id}.sh`,
      `    sortOrder: ${sortOrder}`,
    ]),
    '',
  ].join('\n')

let dir: string
let defDir: string
const originals = {
  defDir: process.env.COMMAND_DEF_DIR,
  sshDir: process.env.COMMAND_SSH_DIR,
  knownHosts: process.env.COMMAND_SSH_KNOWN_HOSTS,
}

/** mtime の粒度でキャッシュが効いてしまわないよう、書き込みのたびに時刻をずらす */
let mtimeSeq = 0
const write = (fileName: string, text: string) => {
  const path = join(defDir, fileName)
  writeFileSync(path, text)
  mtimeSeq += 1
  const at = new Date(Date.now() + mtimeSeq * 1000)
  utimesSync(path, at, at)
}

/** stat の間引き(COMMAND_CATALOG_STAT_INTERVAL_MS)を跨がせる */
const advance = () => {
  vi.setSystemTime(Date.now() + 5_000)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devuntu-command-'))
  defDir = join(dir, 'commands')
  mkdirSync(defDir)
  process.env.COMMAND_DEF_DIR = defDir
  process.env.COMMAND_SSH_DIR = dir
  process.env.COMMAND_SSH_KNOWN_HOSTS = join(dir, 'known_hosts')
  clearCommandCatalogCache()
  mtimeSeq = 0
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  restore('COMMAND_DEF_DIR', originals.defDir)
  restore('COMMAND_SSH_DIR', originals.sshDir)
  restore('COMMAND_SSH_KNOWN_HOSTS', originals.knownHosts)
  clearCommandCatalogCache()
})

describe('対象ファイルの選別', () => {
  it('拡張子で絞り、名前順に並べる', () => {
    expect(listCommandDefFileNames(['b.yml', 'a.yaml', 'notes.txt', 'c.yaml.bak', 'sub'])).toEqual(['a.yaml', 'b.yml'])
  })

  it('ドットで始まるものは読まない', () => {
    // エディタのロックファイル(実体の無いリンク)や ConfigMap の ..data を踏まないため
    expect(listCommandDefFileNames(['.#a.yaml', '..data', 'a.yaml'])).toEqual(['a.yaml'])
  })

  it('走査の上限は選別と名前順の確定より後に掛ける', () => {
    // 選別より前に上限を掛けると、無関係なエントリが上限を埋めた時点で対象の YAML が落ちる。
    // 落ちたファイルは指紋にも入らないので、編集しても読み直されなくなる
    for (let index = 0; index < MAX_COMMAND_DEF_ENTRIES; index += 1) {
      write(`pad-${String(index).padStart(4, '0')}.txt`, 'padding')
    }
    // 名前順で pad-* より後ろに来るので、選別前に上限を掛けると必ず溢れる
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))

    const result = getCommandCatalog({ force: true })
    expect(result.issues).toEqual([])
    expect(result.catalog.commands.map((command) => command.id)).toEqual(['deploy-web'])
  })

  it('対象ファイルが走査の上限を超えたらディレクトリ単位の問題として返す', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    for (let index = 0; index < MAX_COMMAND_DEF_ENTRIES; index += 1) {
      write(`zz-${String(index).padStart(4, '0')}.yaml`, 'version: 1\n')
    }

    const result = getCommandCatalog({ force: true })
    const overflow = result.issues.find((issue) => issue.fileName === null)
    expect(overflow?.messages[0]).toContain(`走査の上限 ${MAX_COMMAND_DEF_ENTRIES} 件`)
    // 名前順の先頭は拾えている
    expect(result.catalog.commands.map((command) => command.id)).toEqual(['deploy-web'])
  })

  it('サブディレクトリの中は見ない', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    mkdirSync(join(defDir, 'sub'))
    writeFileSync(join(defDir, 'sub', 'db01.yaml'), yaml('db01', [['dump-db', 1]]))

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands.map((command) => command.id)).toEqual(['deploy-web'])
  })
})

describe('読み込み', () => {
  it('複数ファイルのコマンドをファイル横断で sortOrder 順に並べる', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 10]]))
    write('db01.yaml', yaml('db01', [['dump-db', 1]]))

    const result = getCommandCatalog({ force: true })
    expect(result.issues).toEqual([])
    expect(result.catalog.commands.map((command) => command.id)).toEqual(['dump-db', 'deploy-web'])
    expect(result.catalog.targets.map((target) => target.id).sort()).toEqual(['db01', 'web01'])
  })

  it('コマンドにそのファイルの実行先を紐づける', () => {
    // targetId は YAML に書かないので、ファイルの境界が唯一の手がかりになる
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    write('db01.yaml', yaml('db01', [['dump-db', 1]]))

    const result = getCommandCatalog({ force: true })
    const byId = new Map(result.catalog.commands.map((command) => [command.id, command.targetId]))
    expect(byId.get('deploy-web')).toBe('web01')
    expect(byId.get('dump-db')).toBe('db01')
  })

  it('壊れたファイルだけを除外し、他のファイルは生かす', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    write('broken.yaml', 'version: 1\ntarget: [unclosed')

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands.map((command) => command.id)).toEqual(['deploy-web'])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].fileName).toBe('broken.yaml')
    expect(result.issues[0].messages[0]).toContain('YAML として読めない')
  })

  it('スキーマ違反はどこが悪いかを返す', () => {
    write('web01.yaml', 'version: 1\ntarget:\n  id: web01\ncommands: []\n')

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands).toEqual([])
    expect(result.issues[0].fileName).toBe('web01.yaml')
    expect(result.issues[0].messages.some((message) => message.startsWith('target.'))).toBe(true)
  })

  it('対象ファイルが無ければ空になるが、それ自体は問題として扱わない', () => {
    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands).toEqual([])
    expect(result.issues).toEqual([])
  })

  it('ディレクトリが無ければ問題として返す', () => {
    // マウント忘れを「コマンドが0件」と同じ見た目にすると、機能が静かに死ぬ
    process.env.COMMAND_DEF_DIR = join(dir, 'missing')
    const result = getCommandCatalog({ force: true })
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].fileName).toBeNull()
    expect(result.issues[0].messages[0]).toContain('定義ディレクトリを読み込めない')
  })

  it('ファイルを指していれば専用の文言を返す', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    process.env.COMMAND_DEF_DIR = join(defDir, 'web01.yaml')

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands).toEqual([])
    expect(result.issues[0].messages[0]).toContain('ディレクトリを指定する')
  })
})

describe('ファイルをまたぐ重複', () => {
  it('実行先IDが重複していればどちらのファイルも読まない', () => {
    write('app-web.yaml', yaml('web01', [['deploy-app', 1]]))
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands).toEqual([])
    expect(result.issues.map((issue) => issue.fileName)).toEqual(['app-web.yaml', 'web01.yaml'])
    expect(result.issues[0].messages[0]).toContain('実行先ID web01')
  })

  it('コマンドIDが重複していればどちらのファイルも読まない', () => {
    // 履歴に残る commandKey と、実際に走ったホスト・実行ファイルが食い違うのを防ぐ
    write('web01.yaml', yaml('web01', [['restart', 1]]))
    write('db01.yaml', yaml('db01', [['restart', 1]]))

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands).toEqual([])
    expect(result.issues.map((issue) => issue.fileName)).toEqual(['db01.yaml', 'web01.yaml'])
    expect(result.issues[0].messages[0]).toContain('コマンドID restart')
  })

  it('重複していないファイルは巻き込まない', () => {
    write('web01.yaml', yaml('web01', [['restart', 1]]))
    write('db01.yaml', yaml('db01', [['restart', 1]]))
    write('cache01.yaml', yaml('cache01', [['flush-cache', 1]]))

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands.map((command) => command.id)).toEqual(['flush-cache'])
  })
})

describe('キャッシュ', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  it('間引きの間は読み直さない', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    expect(getCommandCatalog().catalog.commands).toHaveLength(1)

    write('db01.yaml', yaml('db01', [['dump-db', 1]]))
    expect(getCommandCatalog().catalog.commands).toHaveLength(1)
  })

  it('ファイルの追加に追随する', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    expect(getCommandCatalog().catalog.commands).toHaveLength(1)

    write('db01.yaml', yaml('db01', [['dump-db', 1]]))
    advance()
    expect(getCommandCatalog().catalog.commands).toHaveLength(2)
  })

  it('ファイルの削除に追随する', () => {
    // ファイルを消しても残りのファイルの mtime は変わらないので、名前の並びも指紋に含める必要がある
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    write('db01.yaml', yaml('db01', [['dump-db', 1]]))
    expect(getCommandCatalog().catalog.commands).toHaveLength(2)

    rmSync(join(defDir, 'db01.yaml'))
    advance()
    expect(getCommandCatalog().catalog.commands.map((command) => command.id)).toEqual(['deploy-web'])
  })

  it('内容の変更に追随する', () => {
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    expect(getCommandCatalog().catalog.commands[0].label).toBe('deploy-web')

    write('web01.yaml', yaml('web01', [['deploy-web', 1]]).replace('label: deploy-web', 'label: 配備'))
    advance()
    expect(getCommandCatalog().catalog.commands[0].label).toBe('配備')
  })

  it('壊れたファイルを読んだら直前の正常な内容を保持しない', () => {
    // 古い定義で動き続けると「直したつもりが反映されていない」に気付けない
    write('web01.yaml', yaml('web01', [['deploy-web', 1]]))
    expect(getCommandCatalog().catalog.commands).toHaveLength(1)

    write('web01.yaml', 'version: 1\ntarget: [unclosed')
    advance()
    expect(getCommandCatalog().catalog.commands).toEqual([])
  })
})

describe('上限', () => {
  it('コマンドの合計が上限を超えるファイルは読み込まない', () => {
    // ファイルの途中で切ると「一部のコマンドだけ消える」になるので、落とす単位はファイル
    const many = (offset: number): [string, number][] =>
      Array.from({ length: 80 }, (_, index) => [`cmd-${offset + index}`, index])
    write('a.yaml', yaml('hosta', many(0)))
    write('b.yaml', yaml('hostb', many(1000)))
    write('c.yaml', yaml('hostc', many(2000)))

    const result = getCommandCatalog({ force: true })
    expect(result.catalog.commands).toHaveLength(160)
    expect(result.issues.map((issue) => issue.fileName)).toEqual(['c.yaml'])
    expect(result.issues[0].messages[0]).toContain('合計が上限')
  })
})

describe('鍵ファイルのパス解決', () => {
  it('COMMAND_SSH_DIR 配下に解決する', () => {
    expect(resolveSshFilePath('ops_ed25519')).toBe(join(dir, 'ops_ed25519'))
  })

  it('外へ抜けるパスは null を返す', () => {
    // 定義スキーマ側でも弾いているが、鍵の置き場所を外へ向けられると被害が大きいので二重に見る
    expect(resolveSshFilePath('../outside')).toBeNull()
  })
})

describe('実行先の状態', () => {
  const file = {
    fileName: 'web01.yaml',
    revision: '0123456789abcdef',
    target: {
      id: 'web01',
      label: 'Web',
      kind: 'ssh' as const,
      host: 'web01.internal',
      port: 22,
      user: 'deploy',
      identityFile: 'ops_ed25519',
      editable: false,
    },
    commands: [],
  }

  it('鍵と known_hosts が無ければ未準備を返す', () => {
    expect(buildCommandTargetStatus(file)).toEqual({
      id: 'web01',
      label: 'Web',
      fileName: 'web01.yaml',
      editable: false,
      revision: '0123456789abcdef',
      identityReady: false,
      knownHostsReady: false,
    })
  })

  it('両方あれば準備済みを返す', () => {
    writeFileSync(join(dir, 'ops_ed25519'), 'dummy-key')
    writeFileSync(join(dir, 'known_hosts'), 'dummy-known-hosts')
    expect(buildCommandTargetStatus(file)).toEqual({
      id: 'web01',
      label: 'Web',
      fileName: 'web01.yaml',
      editable: false,
      revision: '0123456789abcdef',
      identityReady: true,
      knownHostsReady: true,
    })
  })

  it('接続先やパスは含めない', () => {
    // 画面にも API 応答にも出さないので、状態オブジェクトの時点で持たせない
    const status = buildCommandTargetStatus(file)
    expect(Object.keys(status).sort()).toEqual([
      'editable',
      'fileName',
      'id',
      'identityReady',
      'knownHostsReady',
      'label',
      'revision',
    ])
  })
})
