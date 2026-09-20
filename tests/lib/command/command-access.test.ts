/**
 * リモート実行の認可判定の単体テスト
 *
 * `src/proxy.ts` は Server Action と `/api/**` を通らないので、この判定がこの機能の認可そのものになる。
 * 特に「管理者にも特権が無い」と「カタログに無いターゲットのアサインは効かない」は、
 * 実装を読み替えたときに緩い側へ倒れると被害が大きいので固定しておく。
 */

import { type CommandDef, type CommandTarget } from '@/lib/command/command'
import { prisma } from '@/lib/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const commandTargetMember = { findMany: vi.fn() }
  const commandTargetGroup = { findMany: vi.fn() }
  return { prisma: { commandTargetMember, commandTargetGroup } }
})

const catalogMock = vi.hoisted(() => ({
  getCommandCatalog: vi.fn(),
  findCommandDef: vi.fn(),
  buildCommandTargetStatus: vi.fn(),
}))
vi.mock('@/lib/command/command-catalog', () => catalogMock)

const {
  assertCommandAccess,
  assertCommandTargetAccess,
  canUseAnyCommand,
  getCommandTargetAccess,
  listAvailableCommands,
  listCommandTargetsForActor,
} = await import('@/lib/command/command-access')

const target = (id: string): CommandTarget => ({
  id,
  label: id.toUpperCase(),
  kind: 'ssh',
  host: `${id}.internal`,
  port: 22,
  user: 'deploy',
  identityFile: 'ops_ed25519',
  editable: false,
  allowFreeInput: false,
})

const def = (id: string, targetId = 'web01', sortOrder = 0): CommandDef => ({
  id,
  label: id,
  targetId,
  executable: '/opt/bin/run.sh',
  args: [],
  inputs: [],
  timeoutSec: 900,
  requireConfirm: true,
  requireFreshSession: false,
  singleton: true,
  sortOrder,
})

/** カタログの中身。ここに載っていないターゲットのアサインは効かないことを確かめるために使う */
const setCatalog = (defs: CommandDef[], targetIds: string[] = ['web01']) => {
  const files = targetIds.map((id) => ({
    fileName: `${id}.yaml`,
    revision: '0'.repeat(16),
    target: target(id),
    commands: defs.filter((entry) => entry.targetId === id),
  }))
  catalogMock.getCommandCatalog.mockReturnValue({
    catalog: { files, targets: targetIds.map(target), commands: defs },
  })
  catalogMock.findCommandDef.mockImplementation((key: string) => defs.find((entry) => entry.id === key) ?? null)
  catalogMock.buildCommandTargetStatus.mockImplementation((file: { target: CommandTarget }) => ({
    id: file.target.id,
    label: file.target.label,
  }))
}

/** 直接メンバーの行。`where` はモックでは解釈されないので、返す行を直接組む */
const setMembers = (rows: { targetKey: string; role: 'owner' | 'member' }[]) => {
  vi.mocked(prisma.commandTargetMember.findMany).mockResolvedValue(rows as never)
}

/** グループ経由でアクセスできるターゲット */
const setGroupTargets = (targetKeys: string[]) => {
  vi.mocked(prisma.commandTargetGroup.findMany).mockResolvedValue(
    targetKeys.map((targetKey) => ({ targetKey })) as never,
  )
}

const admin = { id: 'admin-1', role: 'admin' }
const user = { id: 'user-1', role: null }

const originalEnabled = process.env.COMMAND_EXEC_ENABLED

beforeEach(() => {
  vi.clearAllMocks()
  process.env.COMMAND_EXEC_ENABLED = 'true'
  setCatalog([def('deploy-web')])
  setMembers([])
  setGroupTargets([])
})

afterEach(() => {
  if (originalEnabled === undefined) {
    delete process.env.COMMAND_EXEC_ENABLED
  } else {
    process.env.COMMAND_EXEC_ENABLED = originalEnabled
  }
})

describe('管理者に特権は無い', () => {
  it('アサインされていない管理者は実行も編集もできない', async () => {
    await expect(assertCommandAccess(admin, 'deploy-web', 'execute')).rejects.toThrow()
    await expect(assertCommandAccess(admin, 'deploy-web', 'edit')).rejects.toThrow()
    expect(await listAvailableCommands(admin)).toEqual([])
    expect(await canUseAnyCommand(admin)).toBe(false)
  })

  it('アサインされていれば一般ユーザーと同じに扱える', async () => {
    setMembers([{ targetKey: 'web01', role: 'member' }])
    const available = await listAvailableCommands(admin)
    expect(available.map((item) => item.def.id)).toEqual(['deploy-web'])
  })
})

describe('ロールの解決', () => {
  it('グループ経由は member になる(owner にはならない)', async () => {
    setGroupTargets(['web01'])
    const access = await getCommandTargetAccess(user, 'web01')
    expect(access).toEqual({ targetKey: 'web01', role: 'member', via: 'group' })
    await expect(assertCommandTargetAccess(user, 'web01', 'edit')).rejects.toThrow()
  })

  it('直接ロールがグループ経由より優先される', async () => {
    setMembers([{ targetKey: 'web01', role: 'owner' }])
    setGroupTargets(['web01'])
    const access = await getCommandTargetAccess(user, 'web01')
    expect(access).toEqual({ targetKey: 'web01', role: 'owner', via: 'member' })
  })

  it('アサインが無ければ null', async () => {
    expect(await getCommandTargetAccess(user, 'web01')).toBeNull()
  })
})

describe('定義の編集はオーナーだけ', () => {
  it('member は編集できない', async () => {
    setMembers([{ targetKey: 'web01', role: 'member' }])
    await expect(assertCommandAccess(user, 'deploy-web', 'execute')).resolves.toBeTruthy()
    await expect(assertCommandAccess(user, 'deploy-web', 'edit')).rejects.toThrow()
  })

  it('owner は実行も編集もできる', async () => {
    setMembers([{ targetKey: 'web01', role: 'owner' }])
    await expect(assertCommandAccess(user, 'deploy-web', 'execute')).resolves.toBeTruthy()
    await expect(assertCommandAccess(user, 'deploy-web', 'edit')).resolves.toBeTruthy()
  })

  it('editable でなくても access は通す(書けない理由は writer が返す)', async () => {
    // ここで潰すと COMMAND_DEF_NOT_EDITABLE と権限不足が同じエラーになり、画面が理由を出し分けられない
    setMembers([{ targetKey: 'web01', role: 'owner' }])
    const { target: resolved } = await assertCommandTargetAccess(user, 'web01', 'edit')
    expect(resolved.editable).toBe(false)
  })
})

describe('カタログに無いターゲット', () => {
  it('定義から消えたターゲットのアサインは権限を持たない', async () => {
    // 定義ファイルを消した後もアサイン行は残る。ここが効くと見えない場所の許可が生き続ける
    setCatalog([def('deploy-web')], ['web01'])
    setMembers([{ targetKey: 'removed-target', role: 'owner' }])

    expect(await getCommandTargetAccess(user, 'removed-target')).toBeNull()
    await expect(assertCommandTargetAccess(user, 'removed-target', 'execute')).rejects.toThrow()
    expect(await listCommandTargetsForActor(user)).toEqual([])
    expect(await canUseAnyCommand(user)).toBe(false)
  })
})

describe('機能全体の無効化', () => {
  it('COMMAND_EXEC_ENABLED が false なら誰も扱えない', async () => {
    process.env.COMMAND_EXEC_ENABLED = 'false'
    setMembers([{ targetKey: 'web01', role: 'owner' }])

    await expect(assertCommandAccess(user, 'deploy-web', 'execute')).rejects.toThrow()
    await expect(assertCommandTargetAccess(user, 'web01', 'edit')).rejects.toThrow()
    expect(await listAvailableCommands(user)).toEqual([])
    expect(await canUseAnyCommand(user)).toBe(false)
  })
})

describe('存在の秘匿', () => {
  it('存在しないコマンドと権限不足を同じ扱いにする', async () => {
    // どのコマンドが定義されているかを、扱えない相手に教えない
    const unknown = await assertCommandAccess(user, 'no-such-command', 'execute').catch((e: Error) => e.message)
    const denied = await assertCommandAccess(user, 'deploy-web', 'execute').catch((e: Error) => e.message)
    expect(unknown).toBe(denied)
  })
})

describe('一覧', () => {
  it('アサインされたターゲットのコマンドだけを返す', async () => {
    setCatalog([def('deploy-web', 'web01'), def('reindex', 'db01')], ['web01', 'db01'])
    setMembers([{ targetKey: 'db01', role: 'member' }])

    const available = await listAvailableCommands(user)
    expect(available.map((item) => item.def.id)).toEqual(['reindex'])
    expect(available[0].targetLabel).toBe('DB01')
  })

  it('定義ファイルの sortOrder 順に並ぶ', async () => {
    setCatalog([def('a', 'web01', 20), def('b', 'web01', 10)])
    setMembers([{ targetKey: 'web01', role: 'member' }])

    const available = await listAvailableCommands(user)
    expect(available.map((item) => item.def.id)).toEqual(['b', 'a'])
  })

  it('コマンドが 0 件のターゲットでもオーナーには見える(定義を作りに行くため)', async () => {
    setCatalog([], ['web01'])
    setMembers([{ targetKey: 'web01', role: 'owner' }])

    expect(await listAvailableCommands(user)).toEqual([])
    expect(await listCommandTargetsForActor(user)).toHaveLength(1)
    expect(await canUseAnyCommand(user)).toBe(true)
  })

  it('コマンドが 0 件のターゲットの member にはメニューを出さない(できることが無い)', async () => {
    // 実行するものも設定への導線も無いので、開いても行き止まりになる
    setCatalog([], ['web01'])
    setMembers([{ targetKey: 'web01', role: 'member' }])

    expect(await listCommandTargetsForActor(user)).toHaveLength(1)
    expect(await canUseAnyCommand(user)).toBe(false)
  })

  it('グループ経由の member も同じに扱う', async () => {
    setCatalog([], ['web01'])
    setGroupTargets(['web01'])

    expect(await canUseAnyCommand(user)).toBe(false)
  })

  it('コマンドを持つターゲットがあれば member にも出す', async () => {
    setCatalog([def('deploy-web', 'web01')], ['web01', 'db01'])
    setMembers([
      { targetKey: 'db01', role: 'member' },
      { targetKey: 'web01', role: 'member' },
    ])

    expect(await canUseAnyCommand(user)).toBe(true)
  })
})
