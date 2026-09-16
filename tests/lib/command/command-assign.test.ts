/**
 * ターゲットへのアサインの読み書きの単体テスト
 *
 * 認可の判定は `command-access.ts` 側が持つので、ここで確かめるのは
 * 「直接メンバーとグループ経由をどう統合するか」と「総入れ替えが取りこぼさないか」。
 */

import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const commandTargetMember = { findMany: vi.fn(), deleteMany: vi.fn() }
  const commandTargetGroup = { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() }
  return { prisma: { commandTargetMember, commandTargetGroup, $transaction: vi.fn() } }
})

const { getCommandTargetUsers, listAssignedTargetKeys, syncCommandTargetGroups } =
  await import('@/lib/command/command-assign')

const user = (id: string, name = id) => ({ id, name, email: `${id}@example.test`, image: null, isAgent: false })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('メンバーの統合', () => {
  it('直接メンバーとグループ経由をまとめ、名前順で返す', async () => {
    vi.mocked(prisma.commandTargetMember.findMany).mockResolvedValue([
      { role: 'owner', user: user('u-b', 'Bravo') },
    ] as never)
    vi.mocked(prisma.commandTargetGroup.findMany).mockResolvedValue([
      { group: { userGroups: [{ user: user('u-a', 'Alpha') }] } },
    ] as never)

    const users = await getCommandTargetUsers('web01')
    expect(users.map((entry) => [entry.name, entry.role, entry.via])).toEqual([
      ['Alpha', null, 'group'],
      ['Bravo', 'owner', 'member'],
    ])
  })

  it('両方に居るユーザーは直接メンバーを優先する', async () => {
    // グループ経由で上書きすると、付けたはずの owner が member 扱いに落ちる
    vi.mocked(prisma.commandTargetMember.findMany).mockResolvedValue([
      { role: 'owner', user: user('u-a', 'Alpha') },
    ] as never)
    vi.mocked(prisma.commandTargetGroup.findMany).mockResolvedValue([
      { group: { userGroups: [{ user: user('u-a', 'Alpha') }] } },
    ] as never)

    const users = await getCommandTargetUsers('web01')
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ role: 'owner', via: 'member' })
  })
})

describe('グループの総入れ替え', () => {
  const tx = () => prisma as unknown as Parameters<typeof syncCommandTargetGroups>[0]

  it('既存を消してから入れ直す', async () => {
    await syncCommandTargetGroups(tx(), 'web01', ['g-1', 'g-2'])

    expect(prisma.commandTargetGroup.deleteMany).toHaveBeenCalledWith({ where: { targetKey: 'web01' } })
    expect(prisma.commandTargetGroup.createMany).toHaveBeenCalledWith({
      data: [
        { targetKey: 'web01', groupId: 'g-1' },
        { targetKey: 'web01', groupId: 'g-2' },
      ],
    })
  })

  it('空配列なら消すだけ', async () => {
    await syncCommandTargetGroups(tx(), 'web01', [])

    expect(prisma.commandTargetGroup.deleteMany).toHaveBeenCalled()
    expect(prisma.commandTargetGroup.createMany).not.toHaveBeenCalled()
  })

  it('同じグループが二重に来ても一意制約で落とさない', async () => {
    await syncCommandTargetGroups(tx(), 'web01', ['g-1', 'g-1'])

    expect(prisma.commandTargetGroup.createMany).toHaveBeenCalledWith({
      data: [{ targetKey: 'web01', groupId: 'g-1' }],
    })
  })
})

describe('アサイン済みのキー', () => {
  it('ユーザー側とグループ側を合わせて重複を畳む', async () => {
    vi.mocked(prisma.commandTargetMember.findMany).mockResolvedValue([
      { targetKey: 'web01' },
      { targetKey: 'db01' },
    ] as never)
    vi.mocked(prisma.commandTargetGroup.findMany).mockResolvedValue([
      { targetKey: 'web01' },
      { targetKey: 'app01' },
    ] as never)

    expect(await listAssignedTargetKeys()).toEqual(['app01', 'db01', 'web01'])
  })
})
