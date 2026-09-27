/**
 * 外部サービス連携の可否設定の単体テスト
 *
 * 許可グループが壊れているときに「全ユーザー許可」へ倒れないこと、
 * 認証情報・グローバル有効化・許可グループの判定順を固定する。
 */

import { prisma } from '@/lib/prisma'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getByGroup: vi.fn<(group: string) => Promise<Record<string, string>>>(),
  setStrings: vi.fn(),
  hasCredentials: vi.fn(() => true),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/kvs', () => ({ getByGroup: mocks.getByGroup, setStrings: mocks.setStrings }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@/lib/prisma', async () => (await import('../helpers/prisma')).mockPrisma({ userGroup: ['findMany'] }))

const { createIntegrationSettings } = await import('@/lib/integration-settings')

const findMany = vi.mocked(prisma.userGroup.findMany)

const settings = createIntegrationSettings({
  group: 'SLACK',
  enabledKey: 'SLACK_ENABLED',
  allowedGroupIdsKey: 'SLACK_ALLOWED_GROUP_IDS',
  hasCredentials: () => mocks.hasCredentials(),
  label: 'Slack',
})

/** KVS に保存されている値 */
const store = (values: Record<string, string>) => mocks.getByGroup.mockResolvedValue(values)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasCredentials.mockReturnValue(true)
  store({ SLACK_ENABLED: 'true', SLACK_ALLOWED_GROUP_IDS: '[]' })
  findMany.mockResolvedValue([])
})

describe('get', () => {
  it('連携のグループで KVS を引く', async () => {
    await settings.get()

    expect(mocks.getByGroup).toHaveBeenCalledWith('SLACK')
  })

  it('未設定なら無効・許可グループなし', async () => {
    store({})

    expect(await settings.get()).toEqual({ enabled: false, allowedGroupIds: [] })
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it('保存値を読み出す', async () => {
    store({ SLACK_ENABLED: 'true', SLACK_ALLOWED_GROUP_IDS: '["g1","g2"]' })

    expect(await settings.get()).toEqual({ enabled: true, allowedGroupIds: ['g1', 'g2'] })
  })

  it.each(['false', 'TRUE', '1', ''])('enabled は "true" のときだけ有効(%j)', async (value) => {
    store({ SLACK_ENABLED: value, SLACK_ALLOWED_GROUP_IDS: '[]' })

    expect((await settings.get()).enabled).toBe(false)
  })

  it('許可グループが空文字なら未設定と同じく全ユーザー許可', async () => {
    store({ SLACK_ENABLED: 'true', SLACK_ALLOWED_GROUP_IDS: '' })

    expect(await settings.get()).toEqual({ enabled: true, allowedGroupIds: [] })
  })

  it.each([
    ['JSON として読めない', '[g1'],
    ['配列でない', '{"id":"g1"}'],
    ['文字列以外を含む', '["g1",2]'],
    ['null', 'null'],
  ])('許可グループが壊れていたら(%s)連携ごと無効にする', async (_, value) => {
    store({ SLACK_ENABLED: 'true', SLACK_ALLOWED_GROUP_IDS: value })

    expect(await settings.get()).toEqual({ enabled: false, allowedGroupIds: [] })
    expect(mocks.logger.warn).toHaveBeenCalledWith({ value }, 'invalid SLACK_ALLOWED_GROUP_IDS')
  })
})

describe('set', () => {
  it('有効化と許可グループを文字列にして同じグループへ保存する', async () => {
    await settings.set({ enabled: true, allowedGroupIds: ['g1'] })

    expect(mocks.setStrings).toHaveBeenCalledWith([
      { key: 'SLACK_ENABLED', value: 'true', group: 'SLACK' },
      { key: 'SLACK_ALLOWED_GROUP_IDS', value: '["g1"]', group: 'SLACK' },
    ])
  })

  it('無効化は "false"、許可グループなしは "[]" で保存する', async () => {
    await settings.set({ enabled: false, allowedGroupIds: [] })

    expect(mocks.setStrings).toHaveBeenCalledWith([
      { key: 'SLACK_ENABLED', value: 'false', group: 'SLACK' },
      { key: 'SLACK_ALLOWED_GROUP_IDS', value: '[]', group: 'SLACK' },
    ])
  })

  it('保存した値は get で同じ形に読み戻せる', async () => {
    const value = { enabled: true, allowedGroupIds: ['g1', 'g2'] }
    await settings.set(value)
    const [enabled, allowed] = mocks.setStrings.mock.calls[0][0] as { key: string; value: string }[]
    store({ [enabled.key]: enabled.value, [allowed.key]: allowed.value })

    expect(await settings.get()).toEqual(value)
  })
})

describe('filterAllowedUserIds', () => {
  it('対象が空なら何も引かない', async () => {
    expect(await settings.filterAllowedUserIds([])).toEqual([])
    expect(mocks.getByGroup).not.toHaveBeenCalled()
  })

  it('認証情報が無ければ設定値に関わらず利用不可', async () => {
    mocks.hasCredentials.mockReturnValue(false)

    expect(await settings.filterAllowedUserIds(['u1'])).toEqual([])
    expect(mocks.getByGroup).not.toHaveBeenCalled()
  })

  it('グローバル無効なら利用不可', async () => {
    store({ SLACK_ENABLED: 'false', SLACK_ALLOWED_GROUP_IDS: '[]' })

    expect(await settings.filterAllowedUserIds(['u1'])).toEqual([])
  })

  it('許可グループが壊れていれば、有効化されていても利用不可', async () => {
    store({ SLACK_ENABLED: 'true', SLACK_ALLOWED_GROUP_IDS: 'broken' })

    expect(await settings.filterAllowedUserIds(['u1'])).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('許可グループ未指定なら全員を通し、所属は引かない', async () => {
    expect(await settings.filterAllowedUserIds(['u1', 'u2'])).toEqual(['u1', 'u2'])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('許可グループ指定ありなら、所属が交差するユーザーだけを渡した順で返す', async () => {
    store({ SLACK_ENABLED: 'true', SLACK_ALLOWED_GROUP_IDS: '["g1","g2"]' })
    findMany.mockResolvedValue([{ userId: 'u3' }, { userId: 'u1' }, { userId: 'u1' }] as never)

    expect(await settings.filterAllowedUserIds(['u1', 'u2', 'u3'])).toEqual(['u1', 'u3'])
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: { in: ['u1', 'u2', 'u3'] }, groupId: { in: ['g1', 'g2'] } },
      select: { userId: true },
    })
  })
})

describe('canUse', () => {
  it('許可されていれば true', async () => {
    expect(await settings.canUse('u1')).toBe(true)
  })

  it('所属が交差しなければ false', async () => {
    store({ SLACK_ENABLED: 'true', SLACK_ALLOWED_GROUP_IDS: '["g1"]' })

    expect(await settings.canUse('u1')).toBe(false)
  })

  it('認証情報が無ければ false', async () => {
    mocks.hasCredentials.mockReturnValue(false)

    expect(await settings.canUse('u1')).toBe(false)
  })
})
