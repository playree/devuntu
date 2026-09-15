/**
 * コマンド実行の認可判定の単体テスト
 *
 * `src/proxy.ts` は Server Action と `/api/**` を通らないので、この判定がこの機能の認可そのものになる。
 * 特に「許可グループが空 = 管理者のみ」は、連携設定(空 = 全ユーザー許可)と逆の既定なので、
 * 実装を読み替えたときに緩い側へ倒れないよう固定しておく。
 */

import { type CommandDef } from '@/lib/command/command'
import { prisma } from '@/lib/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const userGroup = { findMany: vi.fn() }
  const commandSetting = { findMany: vi.fn() }
  return { prisma: { userGroup, commandSetting } }
})

const catalogMock = vi.hoisted(() => ({ listCommandDefs: vi.fn(), findCommandDef: vi.fn() }))
vi.mock('@/lib/command/command-catalog', () => catalogMock)

const { assertCommandAccess, canUseAnyCommand, effectiveSortOrder, listAvailableCommands } =
  await import('@/lib/command/command-access')

const def = (id: string, sortOrder = 0): CommandDef => ({
  id,
  label: id,
  targetId: 'web01',
  executable: '/opt/bin/run.sh',
  args: [],
  inputs: [],
  timeoutSec: 900,
  requireConfirm: true,
  requireFreshSession: false,
  singleton: true,
  sortOrder,
})

const admin = { id: 'admin-1', role: 'admin' }
const member = { id: 'user-1', role: null }

/** DB の設定行。省略したコマンドは「未登録」= 既定(無効・許可グループ無し)になる */
const setSettings = (rows: { commandKey: string; enabled: boolean; sortOrder?: number; groupIds?: string[] }[]) => {
  vi.mocked(prisma.commandSetting.findMany).mockResolvedValue(
    rows.map((row) => ({
      commandKey: row.commandKey,
      enabled: row.enabled,
      sortOrder: row.sortOrder ?? 0,
      allowedGroups: (row.groupIds ?? []).map((groupId) => ({ groupId })),
    })) as never,
  )
}

const setMemberships = (groupIds: string[]) => {
  vi.mocked(prisma.userGroup.findMany).mockResolvedValue(groupIds.map((groupId) => ({ groupId })) as never)
}

const originalEnabled = process.env.COMMAND_EXEC_ENABLED

beforeEach(() => {
  vi.clearAllMocks()
  process.env.COMMAND_EXEC_ENABLED = 'true'
  catalogMock.listCommandDefs.mockReturnValue([def('deploy-web')])
  catalogMock.findCommandDef.mockImplementation((key: string) => (key === 'deploy-web' ? def('deploy-web') : null))
  setSettings([])
  setMemberships([])
})

afterEach(() => {
  if (originalEnabled === undefined) {
    delete process.env.COMMAND_EXEC_ENABLED
  } else {
    process.env.COMMAND_EXEC_ENABLED = originalEnabled
  }
})

describe('許可グループが空 = 管理者のみ', () => {
  it('有効でも許可グループが空なら一般ユーザーは扱えない', () => {
    // integration-settings.ts の「空 = 全ユーザー許可」とは意図的に逆
    setSettings([{ commandKey: 'deploy-web', enabled: true, groupIds: [] }])
    return expect(listAvailableCommands(member)).resolves.toEqual([])
  })

  it('許可グループに属していれば扱える', async () => {
    setSettings([{ commandKey: 'deploy-web', enabled: true, groupIds: ['group-a'] }])
    setMemberships(['group-a'])
    const available = await listAvailableCommands(member)
    expect(available.map((item) => item.def.id)).toEqual(['deploy-web'])
  })

  it('別のグループにしか属していなければ扱えない', async () => {
    setSettings([{ commandKey: 'deploy-web', enabled: true, groupIds: ['group-a'] }])
    setMemberships(['group-b'])
    expect(await listAvailableCommands(member)).toEqual([])
  })

  it('管理者は許可グループが空でも扱える', async () => {
    setSettings([{ commandKey: 'deploy-web', enabled: true, groupIds: [] }])
    const available = await listAvailableCommands(admin)
    expect(available.map((item) => item.def.id)).toEqual(['deploy-web'])
  })
})

describe('有効化', () => {
  it('未登録(既定は無効)のコマンドは一般ユーザーに出さない', async () => {
    setSettings([])
    setMemberships(['group-a'])
    expect(await listAvailableCommands(member)).toEqual([])
  })

  it('無効でも管理者には見える(設定するために一覧が要る)', async () => {
    setSettings([{ commandKey: 'deploy-web', enabled: false }])
    const available = await listAvailableCommands(admin)
    expect(available.map((item) => item.def.id)).toEqual(['deploy-web'])
  })

  it('管理者でも無効なコマンドは実行できない', async () => {
    // 見えることと実行できることを分けないと、有効化の設定が意味を失う
    setSettings([{ commandKey: 'deploy-web', enabled: false }])
    await expect(assertCommandAccess(admin, 'deploy-web', 'view')).resolves.toBeTruthy()
    await expect(assertCommandAccess(admin, 'deploy-web', 'execute')).rejects.toThrow()
  })
})

describe('機能全体の無効化', () => {
  it('COMMAND_EXEC_ENABLED が false なら管理者でも扱えない', async () => {
    process.env.COMMAND_EXEC_ENABLED = 'false'
    setSettings([{ commandKey: 'deploy-web', enabled: true, groupIds: [] }])
    await expect(assertCommandAccess(admin, 'deploy-web', 'view')).rejects.toThrow()
    expect(await canUseAnyCommand(admin)).toBe(false)
  })
})

describe('assertCommandAccess', () => {
  it('存在しないコマンドは権限不足と同じ扱いにする', async () => {
    // どのコマンドが定義されているかを、扱えない相手に教えない
    setSettings([{ commandKey: 'deploy-web', enabled: true, groupIds: [] }])
    const unknown = assertCommandAccess(admin, 'no-such-command', 'view').catch((e: Error) => e.message)
    const denied = assertCommandAccess(member, 'deploy-web', 'view').catch((e: Error) => e.message)
    expect(await unknown).toBe(await denied)
  })

  it('扱えるなら定義と設定を返す', async () => {
    setSettings([{ commandKey: 'deploy-web', enabled: true, groupIds: ['group-a'] }])
    setMemberships(['group-a'])
    const { def: resolved, setting } = await assertCommandAccess(member, 'deploy-web', 'execute')
    expect(resolved.id).toBe('deploy-web')
    expect(setting.allowedGroupIds).toEqual(['group-a'])
  })
})

describe('並び順', () => {
  it('DB の sortOrder が定義ファイルの並びより優先される', async () => {
    catalogMock.listCommandDefs.mockReturnValue([def('a', 1), def('b', 2)])
    setSettings([
      { commandKey: 'a', enabled: true, sortOrder: 20 },
      { commandKey: 'b', enabled: true, sortOrder: 10 },
    ])
    const available = await listAvailableCommands(admin)
    expect(available.map((item) => item.def.id)).toEqual(['b', 'a'])
  })
})

describe('listAvailableCommands の need', () => {
  it("need='execute' なら無効なコマンドは管理者にも出さない", async () => {
    // 一覧に出るのに実行すると弾かれる、という食い違いを作らない
    catalogMock.listCommandDefs.mockReturnValue([def('enabled-one'), def('disabled-one')])
    setSettings([
      { commandKey: 'enabled-one', enabled: true },
      { commandKey: 'disabled-one', enabled: false },
    ])
    const view = await listAvailableCommands(admin, 'view')
    const execute = await listAvailableCommands(admin, 'execute')
    expect(view.map((item) => item.def.id).sort()).toEqual(['disabled-one', 'enabled-one'])
    expect(execute.map((item) => item.def.id)).toEqual(['enabled-one'])
  })
})

describe('effectiveSortOrder', () => {
  it('未登録なら定義ファイルの並びを使う', () => {
    expect(
      effectiveSortOrder(
        { commandKey: 'a', enabled: false, sortOrder: 0, allowedGroupIds: [], registered: false },
        def('a', 30),
      ),
    ).toBe(30)
  })

  it('保存された値があればそちらを優先する', () => {
    expect(
      effectiveSortOrder(
        { commandKey: 'a', enabled: true, sortOrder: 5, allowedGroupIds: [], registered: true },
        def('a', 30),
      ),
    ).toBe(5)
  })

  it('明示的に保存された 0 を定義ファイルの値へ戻さない', () => {
    // 0 は先頭へ寄せる正当な指定。値の真偽で未登録と見分けようとすると消えてしまう
    expect(
      effectiveSortOrder(
        { commandKey: 'a', enabled: true, sortOrder: 0, allowedGroupIds: [], registered: true },
        def('a', 30),
      ),
    ).toBe(0)
  })

  it('保存された 0 のコマンドが先頭へ来る', async () => {
    catalogMock.listCommandDefs.mockReturnValue([def('pinned', 30), def('other', 10)])
    setSettings([
      { commandKey: 'pinned', enabled: true, sortOrder: 0 },
      { commandKey: 'other', enabled: true, sortOrder: 10 },
    ])
    const available = await listAvailableCommands(admin)
    expect(available.map((item) => item.def.id)).toEqual(['pinned', 'other'])
  })

  it('未登録のコマンドも定義ファイルの並びで表示される', async () => {
    // DB 側の既定 0 をそのまま使うと、未設定のコマンドが必ず先頭へ来てしまう
    catalogMock.listCommandDefs.mockReturnValue([def('later', 30), def('earlier', 10)])
    setSettings([])
    const available = await listAvailableCommands(admin)
    expect(available.map((item) => item.def.id)).toEqual(['earlier', 'later'])
  })
})
