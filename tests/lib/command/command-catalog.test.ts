/**
 * コマンド定義ファイルの読み込みの単体テスト
 *
 * 固定したいのは2点。
 * - 壊れた定義で **前回の内容を使い続けない**(fail closed)
 * - stat の変化でプロセスが自律的に追随する(リロードの伝播機構を持たなくてよい根拠)
 */

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// logger はテスト出力を汚すだけなので黙らせる
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const { clearCommandCatalogCache, getCommandCatalog, buildCommandHostStatus, resolveSshFilePath } =
  await import('@/lib/command/command-catalog')

const VALID = `
version: 1
hosts:
  - id: web01
    label: Web
    host: web01.internal
    user: deploy
    identityFile: ops_ed25519
commands:
  - id: deploy-web
    label: デプロイ
    hostId: web01
    executable: /opt/bin/deploy.sh
    sortOrder: 10
  - id: restart-web
    label: 再起動
    hostId: web01
    executable: /opt/bin/restart.sh
    sortOrder: 1
`

let dir: string
let defPath: string
const originals = {
  defPath: process.env.COMMAND_DEF_PATH,
  sshDir: process.env.COMMAND_SSH_DIR,
  knownHosts: process.env.COMMAND_SSH_KNOWN_HOSTS,
}

/** mtime の粒度でキャッシュが効いてしまわないよう、書き込みのたびに時刻をずらす */
let mtimeSeq = 0
const write = (text: string) => {
  writeFileSync(defPath, text)
  mtimeSeq += 1
  const at = new Date(Date.now() + mtimeSeq * 1000)
  utimesSync(defPath, at, at)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devuntu-command-'))
  defPath = join(dir, 'commands.yaml')
  process.env.COMMAND_DEF_PATH = defPath
  process.env.COMMAND_SSH_DIR = dir
  process.env.COMMAND_SSH_KNOWN_HOSTS = join(dir, 'known_hosts')
  clearCommandCatalogCache()
  mtimeSeq = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  restore('COMMAND_DEF_PATH', originals.defPath)
  restore('COMMAND_SSH_DIR', originals.sshDir)
  restore('COMMAND_SSH_KNOWN_HOSTS', originals.knownHosts)
  clearCommandCatalogCache()
})

describe('読み込み', () => {
  it('正しい定義を読み、sortOrder 順に並べる', () => {
    write(VALID)
    const result = getCommandCatalog({ force: true })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.catalog.commands.map((command) => command.id)).toEqual(['restart-web', 'deploy-web'])
    expect(result.catalog.hosts).toHaveLength(1)
  })

  it('ファイルが無ければエラーを返す', () => {
    const result = getCommandCatalog({ force: true })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.issues[0]).toContain('定義ファイルを読み込めない')
  })

  it('YAML として壊れていればエラーを返す', () => {
    write('version: 1\nhosts: [unclosed')
    const result = getCommandCatalog({ force: true })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.issues[0]).toContain('YAML として読めない')
  })

  it('スキーマ違反はどこが悪いかを返す', () => {
    write('version: 1\nhosts: []\ncommands:\n  - id: x\n    label: X\n    hostId: nope\n    executable: /bin/true\n')
    const result = getCommandCatalog({ force: true })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.issues.some((issue) => issue.includes('未定義のホスト nope'))).toBe(true)
  })
})

describe('キャッシュ', () => {
  it('内容が変わればプロセスが自律的に追随する', () => {
    write(VALID)
    const first = getCommandCatalog({ force: true })
    expect(first.ok).toBe(true)

    write(VALID.replace('label: デプロイ', 'label: 配備'))
    const second = getCommandCatalog({ force: true })
    expect(second.ok && second.catalog.commands.some((command) => command.label === '配備')).toBe(true)
  })

  it('壊れた定義を読んだら直前の正常な内容を保持しない', () => {
    // 古い定義で動き続けると「直したつもりが反映されていない」に気付けない
    write(VALID)
    expect(getCommandCatalog({ force: true }).ok).toBe(true)

    write('version: 1\nhosts: [unclosed')
    expect(getCommandCatalog({ force: true }).ok).toBe(false)
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

describe('ホストの状態', () => {
  const host = {
    id: 'web01',
    label: 'Web',
    kind: 'ssh' as const,
    host: 'web01.internal',
    port: 22,
    user: 'deploy',
    identityFile: 'ops_ed25519',
  }

  it('鍵と known_hosts が無ければ未準備を返す', () => {
    expect(buildCommandHostStatus(host)).toEqual({
      id: 'web01',
      label: 'Web',
      identityReady: false,
      knownHostsReady: false,
    })
  })

  it('両方あれば準備済みを返す', () => {
    writeFileSync(join(dir, 'ops_ed25519'), 'dummy-key')
    writeFileSync(join(dir, 'known_hosts'), 'dummy-known-hosts')
    expect(buildCommandHostStatus(host)).toEqual({
      id: 'web01',
      label: 'Web',
      identityReady: true,
      knownHostsReady: true,
    })
  })

  it('接続先やパスは含めない', () => {
    // 画面にも API 応答にも出さないので、状態オブジェクトの時点で持たせない
    const status = buildCommandHostStatus(host)
    expect(Object.keys(status).sort()).toEqual(['id', 'identityReady', 'knownHostsReady', 'label'])
  })
})
